const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const XLSX = require("xlsx");
const { normalizeUSPhone } = require("../utils/phone");

const DB_URL = process.env.DATABASE_URL || "";
const needsSSL = DB_URL && !DB_URL.includes(".railway.internal") && !DB_URL.includes("railway.internal");
const sslConfig = needsSSL ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  connectionString: DB_URL,
  ssl: sslConfig,
  connectionTimeoutMillis: 8000,
});

const IMPORT_TIMEZONE = "America/Indiana/Indianapolis";

function usage() {
  console.log("Usage:");
  console.log(
    "  node scripts/import_calendar_events_xlsx.js \"/local/path/Patriot Auto Restyling Calendar Events Jan 1st 2025 to Dec 31st 2025.xlsx\""
  );
  console.log("  DATABASE_URL=... npm run db:import:calendar -- \"/local/path/file.xlsx\"");
  console.log("  (On Railway one-off) npm run db:import:calendar -- \"/app/file.xlsx\"");
}

function sanitizeText(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function normalizeCandidateVin(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).replace(/[^0-9a-z]/gi, "").toUpperCase();
  return normalized || null;
}

function isValidVin(value) {
  const vin = normalizeCandidateVin(value);
  return !!vin && vin.length === 17 && /^[A-HJ-NPR-Z0-9]{17}$/.test(vin);
}

function extractVinFromText(text) {
  const cleaned = sanitizeText(text);
  if (!cleaned) return null;

  const explicitMatch = /\(VIN:\s*([^\)]+)\)/i.exec(cleaned);
  if (explicitMatch) {
    const candidate = normalizeCandidateVin(explicitMatch[1]);
    if (isValidVin(candidate)) return candidate;
  }

  const vinLikePattern = /(?:^|\b)([A-HJ-NPR-Z0-9][A-HJ-NPR-Z0-9\s\-]{16,})(?:\b|$)/gi;
  let match;
  while ((match = vinLikePattern.exec(cleaned))) {
    const candidate = normalizeCandidateVin(match[1]);
    if (isValidVin(candidate)) return candidate;
  }

  return null;
}

function selectColumn(row, candidates) {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  return null;
}

async function getLegacyPhoneColumn() {
  const sql = `
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'par'
      AND table_name = 'customers'
      AND column_name IN ('phone', 'phone_number', 'phonenumber', 'mobile', 'cell', 'primary_phone', 'primaryphone')
    ORDER BY
      CASE column_name
        WHEN 'phone' THEN 1
        WHEN 'phone_number' THEN 2
        WHEN 'phonenumber' THEN 3
        WHEN 'primary_phone' THEN 4
        WHEN 'primaryphone' THEN 5
        WHEN 'mobile' THEN 6
        WHEN 'cell' THEN 7
        ELSE 8
      END
    LIMIT 1;
  `;
  const { rows } = await pool.query(sql);
  return rows[0]?.column_name || "phone";
}

async function loadCustomerLookups(legacyPhoneColumn) {
  const sql = `
    SELECT
      id,
      legacy_client_id,
      email,
      phone_e164,
      phone_display,
      phone_raw,
      ${legacyPhoneColumn} AS legacy_phone,
      first_name,
      last_name
    FROM par.customers
  `;
  const { rows } = await pool.query(sql);

  const byLegacyClientId = new Map();
  const byEmail = new Map();
  const byPhone = new Map();
  const byName = new Map();

  for (const row of rows) {
    if (row.legacy_client_id) {
      const key = String(row.legacy_client_id).trim();
      if (!byLegacyClientId.has(key)) byLegacyClientId.set(key, row);
    }

    if (row.email) {
      const emailKey = String(row.email).trim().toLowerCase();
      if (!byEmail.has(emailKey)) {
        byEmail.set(emailKey, row);
      } else {
        byEmail.set(emailKey, null);
      }
    }

    const phoneCandidates = [row.phone_e164, row.phone_display, row.phone_raw, row.legacy_phone];
    for (const candidate of phoneCandidates) {
      const normalized = normalizeUSPhone(candidate);
      if (!normalized.valid) continue;
      const key = normalized.e164;
      if (!byPhone.has(key)) {
        byPhone.set(key, row);
      } else {
        byPhone.set(key, null);
      }
    }

    const fullName = sanitizeText(`${row.first_name || ""} ${row.last_name || ""}`.trim());
    if (fullName) {
      const key = fullName.toLowerCase();
      if (!byName.has(key)) {
        byName.set(key, row);
      } else {
        byName.set(key, null);
      }
    }
  }

  return { byLegacyClientId, byEmail, byPhone, byName };
}

function parseVehicleInfo(vehicleStr) {
  const text = sanitizeText(vehicleStr) || "";
  const vin = extractVinFromText(text);

  const yearMatch = /^\s*(\d{4})\s+/.exec(text);
  if (!yearMatch) {
    return { vin, year: null, make: null, model: null, trim: null };
  }

  const year = Number(yearMatch[1]);
  const afterYear = text.slice(yearMatch[0].length).trim();

  const parenIndex = afterYear.indexOf("(");
  const modelSection = parenIndex >= 0 ? afterYear.slice(0, parenIndex).trim() : afterYear;
  const tokens = modelSection.split(/\s+/).filter(Boolean);

  if (!tokens.length) {
    return { vin, year, make: null, model: null, trim: null };
  }

  const make = tokens[0];
  const remaining = tokens.slice(1);

  const modelTokens = remaining.slice(0, 3);
  const model = modelTokens.length ? modelTokens.join(" ") : null;

  const trimTokens = remaining.slice(modelTokens.length);
  const trim = trimTokens.length ? trimTokens.join(" ") : null;

  return { vin, year, make, model, trim };
}

function parseDateParts(dateValue) {
  if (!dateValue) return null;
  if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
    return { year: dateValue.getFullYear(), month: dateValue.getMonth() + 1, day: dateValue.getDate() };
  }

  const asString = sanitizeText(dateValue);
  if (!asString) return null;

  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(asString);
  if (!match) {
    match = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/.exec(asString);
    if (match) {
      const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
      return { year, month: Number(match[1]), day: Number(match[2]) };
    }
  }

  if (match) {
    return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  }

  const parsed = new Date(asString);
  if (isNaN(parsed.getTime())) return null;
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
}

function parseTimeParts(timeValue) {
  if (!timeValue) return null;
  if (timeValue instanceof Date && !isNaN(timeValue.getTime())) {
    return { hours: timeValue.getHours(), minutes: timeValue.getMinutes(), seconds: timeValue.getSeconds() };
  }

  const asString = sanitizeText(timeValue);
  if (!asString) return null;

  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(asString);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = Number(match[2] || 0);
  const seconds = 0;
  const suffix = match[3] ? match[3].toLowerCase() : null;

  if (suffix === "pm" && hours < 12) hours += 12;
  if (suffix === "am" && hours === 12) hours = 0;

  if (hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60) {
    return { hours, minutes, seconds };
  }

  return null;
}

function getTimezoneOffset(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = dtf.formatToParts(date);
  const values = {};
  for (const { type, value } of parts) {
    if (type !== "literal") values[type] = value;
  }
  const asUTC = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return (asUTC - date.getTime()) / 60000;
}

function combineDateAndTime(dateValue, timeValue) {
  const dateParts = parseDateParts(dateValue);
  if (!dateParts) return null;

  const timeParts = parseTimeParts(timeValue) || { hours: 0, minutes: 0, seconds: 0 };
  const utcGuess = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, timeParts.hours, timeParts.minutes, timeParts.seconds));
  const offsetMinutes = getTimezoneOffset(utcGuess, IMPORT_TIMEZONE);
  const zoned = new Date(utcGuess.getTime() - offsetMinutes * 60000);
  return zoned.toISOString();
}

function buildDescription(row) {
  const parts = [];

  const primaryService = sanitizeText(row["Primary Service"]);
  const allServices = sanitizeText(row["All Services/Packages/Variations"]);
  const clientName = sanitizeText(row["Client"]);
  const clientPhone = sanitizeText(row["Client Phone"]);
  const clientEmail = sanitizeText(row["Client Email"]);
  const vehicle = sanitizeText(row["Vehicle"]);
  const primaryStaff = sanitizeText(row["Primary Staff"]);
  const assignedStaff = sanitizeText(row["All Assigned Staff"]);
  const bay = sanitizeText(row["Bay"]);
  const color = sanitizeText(row["Color"]);
  const notes = sanitizeText(row["Notes"]);
  const basePrice = sanitizeText(row["Base Price"]);
  const extrasPrice = sanitizeText(row["Extras Price"]);
  const total = sanitizeText(row["Computed Total"]);
  const completed = sanitizeText(row["Completed"]);
  const urgent = sanitizeText(row["Urgent"]);

  if (primaryService) parts.push(`Primary Service: ${primaryService}`);
  if (allServices) parts.push(`All Services: ${allServices}`);
  if (clientName) parts.push(`Client: ${clientName}`);
  if (clientPhone || clientEmail) {
    const contactPieces = [];
    if (clientPhone) contactPieces.push(`Phone: ${clientPhone}`);
    if (clientEmail) contactPieces.push(`Email: ${clientEmail}`);
    parts.push(`Contact: ${contactPieces.join(" | ")}`);
  }
  if (vehicle) parts.push(`Vehicle: ${vehicle}`);
  if (primaryStaff) parts.push(`Primary Staff: ${primaryStaff}`);
  if (assignedStaff) parts.push(`Assigned Staff: ${assignedStaff}`);
  if (bay) parts.push(`Bay: ${bay}`);
  if (color) parts.push(`Color: ${color}`);
  if (notes) parts.push(`Notes: ${notes}`);

  const pricePieces = [];
  if (basePrice) pricePieces.push(`Base: ${basePrice}`);
  if (extrasPrice) pricePieces.push(`Extras: ${extrasPrice}`);
  if (total) pricePieces.push(`Total: ${total}`);
  if (pricePieces.length) parts.push(`Pricing: ${pricePieces.join(" | ")}`);

  if (completed) parts.push(`Completed: ${completed}`);
  if (urgent) parts.push(`Urgent: ${urgent}`);

  return parts.join("\n");
}

function findCustomerId(row, lookups) {
  const legacyClientId = sanitizeText(row["Client ID"]);
  if (legacyClientId && lookups.byLegacyClientId.get(legacyClientId)) {
    return lookups.byLegacyClientId.get(legacyClientId).id;
  }

  const email = sanitizeText(row["Client Email"]);
  if (email) {
    const emailKey = email.toLowerCase();
    const found = lookups.byEmail.get(emailKey);
    if (found) return found.id;
  }

  const phoneRaw = selectColumn(row, ["Client Phone", "Phone", "Contact"]);
  if (phoneRaw) {
    const normalized = normalizeUSPhone(phoneRaw);
    if (normalized.valid) {
      const found = lookups.byPhone.get(normalized.e164);
      if (found) return found.id;
    }
  }

  const clientName = sanitizeText(row["Client"]);
  if (clientName) {
    const found = lookups.byName.get(clientName.toLowerCase());
    if (found) return found.id;
  }

  return null;
}

async function importEvents(rows) {
  const legacyPhoneColumn = await getLegacyPhoneColumn();
  const customerLookups = await loadCustomerLookups(legacyPhoneColumn);

  let processed = 0;
  let inserted = 0;
  let updated = 0;
  let linkedCustomers = 0;
  let vinsFound = 0;
  const vinFoundBySource = { vehicle_col: 0, title: 0, notes: 0, other: 0 };
  let vehiclesCreatedOrUpdated = 0;
  let fkAvoidedCount = 0;

  for (const row of rows) {
    const legacyEventId = sanitizeText(row["Event ID"]);
    if (!legacyEventId) continue;

    const eventDate = combineDateAndTime(row["Event Date"], row["Start Time"]);
    const title = sanitizeText(row["Title"]) || sanitizeText(row["Vehicle"]) || sanitizeText(row["Primary Service"]);
    const description = buildDescription(row);
    const vehicleInfo = parseVehicleInfo(row["Vehicle"]);
    const vinChecks = [
      { value: row["Vehicle"], source: "vehicle_col" },
      { value: row["Title"], source: "title" },
      { value: row["Notes"], source: "notes" },
      { value: row["All Services/Packages/Variations"], source: "other" },
      { value: row["Client"], source: "other" },
      { value: row["Address"], source: "other" },
      { value: row["Client Phone"], source: "other" },
    ];

    let vehicleVin = null;
    for (const check of vinChecks) {
      const found = extractVinFromText(check.value);
      if (found) {
        vehicleVin = found;
        vinFoundBySource[check.source] += 1;
        break;
      }
    }

    if (!vehicleVin && vehicleInfo.vin) {
      vehicleVin = vehicleInfo.vin;
      vinFoundBySource.vehicle_col += 1;
    }
    const customerId = findCustomerId(row, customerLookups);

    processed += 1;
    if (customerId) linkedCustomers += 1;
    if (vehicleVin) vinsFound += 1;

    if (vehicleVin) {
      const vehicleSql = `
        INSERT INTO par.vehicles (vin, customer_id, year, make, model, trim)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (vin) DO UPDATE SET
          customer_id = COALESCE(EXCLUDED.customer_id, par.vehicles.customer_id),
          year = COALESCE(EXCLUDED.year, par.vehicles.year),
          make = COALESCE(NULLIF(EXCLUDED.make,''), par.vehicles.make),
          model = COALESCE(NULLIF(EXCLUDED.model,''), par.vehicles.model),
          trim = COALESCE(NULLIF(EXCLUDED.trim,''), par.vehicles.trim),
          updated_at = NOW();
      `;

      const vehicleParams = [
        vehicleVin,
        customerId,
        vehicleInfo.year,
        vehicleInfo.make,
        vehicleInfo.model,
        vehicleInfo.trim,
      ];

      const { rowCount } = await pool.query(vehicleSql, vehicleParams);
      if (rowCount) {
        vehiclesCreatedOrUpdated += rowCount;
        fkAvoidedCount += 1;
      }
    }

    const insertSql = `
      INSERT INTO par.customer_events (
        legacy_event_id, customer_id, vehicle_vin, event_date, title, description, source
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'calendar_import')
      ON CONFLICT (legacy_event_id) DO UPDATE SET
        customer_id = COALESCE(EXCLUDED.customer_id, par.customer_events.customer_id),
        vehicle_vin = COALESCE(EXCLUDED.vehicle_vin, par.customer_events.vehicle_vin),
        event_date = COALESCE(EXCLUDED.event_date, par.customer_events.event_date),
        title = COALESCE(NULLIF(EXCLUDED.title,''), par.customer_events.title),
        description = COALESCE(NULLIF(EXCLUDED.description,''), par.customer_events.description),
        source = COALESCE(NULLIF(EXCLUDED.source,''), par.customer_events.source)
      RETURNING (xmax = 0) AS inserted, customer_id, vehicle_vin;
    `;

    const params = [legacyEventId, customerId, vehicleVin, eventDate, title, description];
    const { rows: results } = await pool.query(insertSql, params);
    if (!results.length) continue;

    if (results[0].inserted) {
      inserted += 1;
    } else {
      updated += 1;
    }
  }

  console.log("Calendar import summary:", {
    rows_processed: processed,
    linked_customers: linkedCustomers,
    vin_found: vinsFound,
    vin_found_by_source: vinFoundBySource,
    vehicles_created_or_updated: vehiclesCreatedOrUpdated,
    fk_avoided_count: fkAvoidedCount,
    inserted,
    updated,
  });
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    usage();
    throw new Error("Missing XLSX file path argument.");
  }

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    usage();
    throw new Error(`File not found: ${resolved}`);
  }

  console.log("Connecting to Postgres...", DB_URL ? "DATABASE_URL provided" : "DATABASE_URL missing!");
  console.log("Reading workbook:", resolved);
  const workbook = XLSX.readFile(resolved, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  console.log(`Rows detected in '${sheetName}':`, rows.length);

  await importEvents(rows);
}

main()
  .catch((err) => {
    console.error("Calendar import failed:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
