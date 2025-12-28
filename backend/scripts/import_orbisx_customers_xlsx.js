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

function usage() {
  console.log("Usage:");
  console.log("  node scripts/import_orbisx_customers_xlsx.js \"/local/path/Patriot Auto Restyling Clients Dec 28th 2025.xlsx\"");
  console.log("  DATABASE_URL=... npm run db:import:orbisx -- \"/local/path/file.xlsx\"");
  console.log("  (On Railway one-off) npm run db:import:orbisx -- \"/app/file.xlsx\"");
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

async function upsertCustomer(row, legacyPhoneColumn) {
  const legacyClientId = sanitizeText(row["Client ID"]);
  if (!legacyClientId) {
    return { skipped: true, reason: "missing_client_id" };
  }

  const firstName = sanitizeText(row["First Name"]);
  const lastName = sanitizeText(row["Last Name"]);
  const name = sanitizeText(row["Name"]);
  const email = sanitizeText(row["Email"]);
  const website = sanitizeText(row["Website"]);
  const company = sanitizeText(row["Company"]);
  const address1 = sanitizeText(row["Address"]);
  const address2 = sanitizeText(row["Address 2"]);
  const city = sanitizeText(row["City"]);
  const state = sanitizeText(row["State/Province"]);
  const zip = sanitizeText(row["Zip/Postal Code"]);
  const country = sanitizeText(row["Country"]);
  const leadId = sanitizeText(row["Lead ID"]);
  const primaryUserAssigned = sanitizeText(row["Primary User Assigned"]);
  const tags = sanitizeText(row["Tags"]);
  const source = sanitizeText(row["Source"]);
  const pnl = sanitizeText(row["P&L"]);
  const notes = sanitizeText(row["Notes"]);
  const phoneRaw = row["Phone"] === undefined ? null : String(row["Phone"]);

  const normalizedPhone = phoneRaw ? normalizeUSPhone(phoneRaw) : { valid: false, raw: phoneRaw, display: phoneRaw || null };
  const phone_e164 = normalizedPhone.valid ? normalizedPhone.e164 : null;
  const phone_display = normalizedPhone.valid ? normalizedPhone.display : normalizedPhone.display;

  const payload = {
    legacy_client_id: legacyClientId,
    legacy_lead_id: leadId,
    lead_created_at: parseDate(row["Lead Created Date"]),
    date_added: parseDate(row["Date Added"]),
    website,
    company,
    business_name: company || sanitizeText(row["Business Name"]),
    unsubscribed_email: row["Unsubscribed Email"] === true || String(row["Unsubscribed Email"] || "").toLowerCase() === "true",
    primary_user_assigned: primaryUserAssigned,
    last_appointment: parseDate(row["Last Appointment"]),
    last_service: parseDate(row["Last Service"]),
    tags,
    source,
    pnl,
    notes,
    first_name: firstName || (name ? name.split(" ")[0] : null),
    last_name: lastName || (name ? name.split(" ").slice(1).join(" ") || null : null),
    email,
    address1,
    address2,
    city,
    state,
    zip,
    country,
    phone_raw: phoneRaw,
    phone_e164,
    phone_display,
    legacy_phone: phone_e164,
  };

  const columns = [
    "legacy_client_id",
    "legacy_lead_id",
    "lead_created_at",
    "date_added",
    "website",
    "company",
    "business_name",
    "unsubscribed_email",
    "primary_user_assigned",
    "last_appointment",
    "last_service",
    "tags",
    "source",
    "pnl",
    "notes",
    "first_name",
    "last_name",
    "email",
    "address1",
    "address2",
    "city",
    "state",
    "zip",
    "country",
    "phone_raw",
    "phone_e164",
    "phone_display",
    legacyPhoneColumn,
  ];

  const values = columns.map((col) => payload[col] ?? null);
  const placeholders = columns.map((_, idx) => `$${idx + 1}`);

  const updateAssignments = columns
    .filter((col) => col !== "legacy_client_id")
    .map((col) => {
      if (col === "phone_raw") {
        return `"${col}" = COALESCE(EXCLUDED."${col}", par.customers."${col}")`;
      }
      return `"${col}" = COALESCE(NULLIF(EXCLUDED."${col}", ''), par.customers."${col}")`;
    })
    .concat(["updated_at = NOW()"]);

  const sql = `
    INSERT INTO par.customers (${columns.map((c) => `"${c}"`).join(", ")})
    VALUES (${placeholders.join(", ")})
    ON CONFLICT (legacy_client_id) DO UPDATE SET
      ${updateAssignments.join(", ")}
    RETURNING id;
  `;

  const { rows } = await pool.query(sql, values);
  return { skipped: false, customerId: rows[0].id, phoneValid: normalizedPhone.valid };
}

async function upsertVehicle(row, customerId) {
  const vin = sanitizeText(row["VIN"]);
  if (!vin || vin.length !== 17) {
    return { inserted: false, reason: "missing_or_invalid_vin" };
  }

  const year = parseInt(row["Year"], 10);
  const make = sanitizeText(row["Make"]);
  const model = sanitizeText(row["Model"]);
  const trim = sanitizeText(row["Trim"]);
  const odometer = row["Odometer"] ? parseInt(row["Odometer"], 10) : null;
  const plate_number = sanitizeText(row["Plate"] || row["Plate Number"]);
  const color = sanitizeText(row["Color"]);
  const vehicle_notes = sanitizeText(row["Vehicle Notes"] || row["Notes"]);

  const columns = [
    "vin",
    "customer_id",
    "year",
    "make",
    "model",
    "trim",
    "odometer",
    "plate_number",
    "color",
    "vehicle_notes",
    "plate",
    "mileage",
    "notes",
  ];

  const values = [
    vin.toUpperCase(),
    customerId,
    Number.isFinite(year) ? year : null,
    make,
    model,
    trim,
    Number.isFinite(odometer) ? odometer : null,
    plate_number,
    color,
    vehicle_notes,
    plate_number,
    Number.isFinite(odometer) ? odometer : null,
    vehicle_notes,
  ];

  const placeholders = columns.map((_, idx) => `$${idx + 1}`);
  const updateAssignments = columns.map((col, idx) => {
    const placeholder = `$${idx + 1}`;
    if (col === "vin" || col === "customer_id") return null;
    return `${col} = COALESCE(NULLIF(${placeholder}, ''), ${col})`;
  }).filter(Boolean);
  updateAssignments.push("updated_at = NOW()");

  const sql = `
    INSERT INTO par.vehicles (${columns.join(", ")})
    VALUES (${placeholders.join(", ")})
    ON CONFLICT (vin) DO UPDATE SET
      ${updateAssignments.join(", ")}
  `;

  await pool.query(sql, values);
  return { inserted: true };
}

async function updateDealerFlags() {
  const sql = `
    WITH vehicle_counts AS (
      SELECT customer_id, COUNT(*) AS vehicle_count
      FROM par.vehicles
      GROUP BY customer_id
    )
    UPDATE par.customers c
    SET is_dealer = TRUE
    FROM vehicle_counts vc
    WHERE c.id = vc.customer_id
      AND (vc.vehicle_count >= 10 OR c.company IS NOT NULL)
      AND c.is_dealer = FALSE;
  `;
  await pool.query(sql);
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
  const legacyPhoneColumn = await getLegacyPhoneColumn();
  console.log("Legacy phone column:", legacyPhoneColumn);
  console.log("Reading workbook:", resolved);

  const workbook = XLSX.readFile(resolved, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  console.log(`Rows detected in '${sheetName}':`, rows.length);

  let customersProcessed = 0;
  let customersSkipped = 0;
  let vehiclesUpserted = 0;
  let vehiclesSkipped = 0;
  let phonesValid = 0;
  let phonesInvalid = 0;

  for (const row of rows) {
    const result = await upsertCustomer(row, legacyPhoneColumn);
    if (result.skipped) {
      customersSkipped += 1;
      continue;
    }

    customersProcessed += 1;
    if (result.phoneValid) {
      phonesValid += 1;
    } else {
      phonesInvalid += 1;
    }

    const vehicleResult = await upsertVehicle(row, result.customerId);
    if (vehicleResult.inserted) {
      vehiclesUpserted += 1;
    } else {
      vehiclesSkipped += 1;
    }
  }

  await updateDealerFlags();

  console.log("Import complete.");
  console.log({
    customers_processed: customersProcessed,
    customers_skipped_missing_id: customersSkipped,
    vehicles_upserted: vehiclesUpserted,
    vehicles_skipped_missing_vin: vehiclesSkipped,
    phones_valid: phonesValid,
    phones_invalid: phonesInvalid,
  });
}

main()
  .catch((err) => {
    console.error("Import failed:", err.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
