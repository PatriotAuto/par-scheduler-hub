const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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

function usage() {
  console.log("Usage:");
  console.log("  node scripts/import_calendar_events_xlsx.js \"/local/path/Patriot Auto Restyling Calendar Events Jan 1st 2025 to Dec 31st 2025.xlsx\"");
  console.log("  DATABASE_URL=... npm run db:import:calendar -- \"/local/path/file.xlsx\"");
  console.log("  (On Railway one-off) npm run db:import:calendar -- \"/app/file.xlsx\"");
}

function sanitizeText(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
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

function deterministicEventId(eventDate, title, normalizedPhone, normalizedName) {
  return crypto
    .createHash("sha256")
    .update(`${eventDate || ""}|${title || ""}|${normalizedPhone || ""}|${normalizedName || ""}`)
    .digest("hex");
}

async function loadVehicles() {
  const sql = `SELECT vin, customer_id FROM par.vehicles`;
  const { rows } = await pool.query(sql);
  const map = new Map();
  rows.forEach((row) => map.set(String(row.vin).toUpperCase(), row));
  return map;
}

async function loadCustomers(legacyPhoneColumn) {
  const sql = `
    SELECT id, first_name, last_name, ${legacyPhoneColumn} AS legacy_phone, phone_e164
    FROM par.customers
  `;
  const { rows } = await pool.query(sql);

  const byPhone = new Map();
  const byName = new Map();

  for (const row of rows) {
    const phoneCandidates = [];
    if (row.phone_e164) phoneCandidates.push(row.phone_e164);
    if (row.legacy_phone) phoneCandidates.push(String(row.legacy_phone));

    for (const candidate of phoneCandidates) {
      const normalized = normalizeUSPhone(candidate);
      if (!normalized.valid) continue;
      const key = normalized.e164;
      if (!byPhone.has(key)) {
        byPhone.set(key, row);
      } else {
        // Multiple customers share phone; mark ambiguous
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

  return { byPhone, byName };
}

function selectColumn(row, candidates) {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  return null;
}

async function resolveCustomerAndVehicle(row, vehiclesByVin, customersByPhone, customersByName) {
  const vinRaw = selectColumn(row, ["VIN", "Vin", "vin"]);
  const vin = vinRaw ? String(vinRaw).trim().toUpperCase() : null;
  if (vin && vehiclesByVin.has(vin)) {
    const vehicle = vehiclesByVin.get(vin);
    return { customerId: vehicle.customer_id, vehicleVin: vehicle.vin };
  }

  const phoneRaw = selectColumn(row, ["Phone", "phone", "Customer Phone", "Customer Contact", "Contact"]);
  if (phoneRaw) {
    const normalized = normalizeUSPhone(phoneRaw);
    if (normalized.valid && customersByPhone.has(normalized.e164) && customersByPhone.get(normalized.e164)) {
      return { customerId: customersByPhone.get(normalized.e164).id, vehicleVin: null };
    }
  }

  const nameRaw = selectColumn(row, ["Name", "Customer", "Client", "Customer Name", "Full Name", "Title", "Subject"]);
  const normalizedName = sanitizeText(nameRaw);
  if (normalizedName) {
    const key = normalizedName.toLowerCase();
    const customer = customersByName.get(key);
    if (customer) {
      return { customerId: customer.id, vehicleVin: null };
    }
  }

  return { customerId: null, vehicleVin: null };
}

async function importEvents(rows) {
  const legacyPhoneColumn = await getLegacyPhoneColumn();
  const vehiclesByVin = await loadVehicles();
  const { byPhone, byName } = await loadCustomers(legacyPhoneColumn);

  let imported = 0;
  let linkedVehicle = 0;
  let linkedCustomerOnly = 0;
  let unlinked = 0;

  for (const row of rows) {
    const eventDate = parseDate(selectColumn(row, ["Start", "Event Date", "Date", "Start Time", "start"]));
    const title = sanitizeText(selectColumn(row, ["Title", "Subject", "Summary", "Event"]));
    const description = sanitizeText(selectColumn(row, ["Description", "Notes", "Details", "Body"]));
    const explicitEventId = sanitizeText(selectColumn(row, ["Event ID", "ID", "Legacy Event ID"]));

    if (!eventDate && !title && !description) {
      continue;
    }

    const { customerId, vehicleVin } = await resolveCustomerAndVehicle(row, vehiclesByVin, byPhone, byName);

    const phoneRaw = selectColumn(row, ["Phone", "Customer Phone", "Contact"]);
    const normalizedPhone = phoneRaw ? normalizeUSPhone(phoneRaw) : { valid: false, e164: null };
    const nameRaw = selectColumn(row, ["Name", "Customer", "Client", "Customer Name", "Full Name"]);
    const normalizedName = sanitizeText(nameRaw);

    const legacyEventId =
      explicitEventId || deterministicEventId(eventDate, title, normalizedPhone.valid ? normalizedPhone.e164 : null, normalizedName);

    const insertSql = `
      INSERT INTO par.customer_events (
        legacy_event_id, customer_id, vehicle_vin, event_date, title, description, source
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'calendar_import')
      ON CONFLICT (legacy_event_id) DO NOTHING
      RETURNING id, vehicle_vin, customer_id;
    `;

    const params = [legacyEventId, customerId, vehicleVin, eventDate, title, description];
    const { rows: inserted } = await pool.query(insertSql, params);
    if (!inserted.length) {
      continue;
    }

    imported += 1;
    if (inserted[0].vehicle_vin) {
      linkedVehicle += 1;
    } else if (inserted[0].customer_id) {
      linkedCustomerOnly += 1;
    } else {
      unlinked += 1;
    }
  }

  console.log("Calendar import summary:", {
    events_imported: imported,
    linked_to_vehicle: linkedVehicle,
    linked_to_customer_only: linkedCustomerOnly,
    unlinked_events: unlinked,
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
