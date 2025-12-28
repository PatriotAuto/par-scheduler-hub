const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const XLSX = require("xlsx");
const { normalizeUSPhone } = require("../utils/phone");

const DB_URL = process.env.DATABASE_URL || "";
const needsSSL =
  DB_URL &&
  !DB_URL.includes(".railway.internal") &&
  !DB_URL.includes("railway.internal");

const sslConfig = needsSSL ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  connectionString: DB_URL,
  ssl: sslConfig,
  connectionTimeoutMillis: 8000,
});

function usage() {
  console.log("Usage:");
  console.log(
    '  node scripts/import_orbisx_customers_xlsx.js "Patriot Auto Restyling Clients Dec 28th 2025.xlsx"'
  );
}

function sanitizeText(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return String(value).trim();
}

function parseDate(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;
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
      AND column_name IN (
        'phone','phone_number','phonenumber',
        'mobile','cell','primary_phone','primaryphone'
      )
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
  if (!legacyClientId) return { skipped: true };

  const phoneRaw = row["Phone"] !== undefined ? String(row["Phone"]) : null;
  const normalizedPhone = phoneRaw
    ? normalizeUSPhone(phoneRaw)
    : { valid: false, display: null };

  const payload = {
    legacy_client_id: legacyClientId,
    legacy_lead_id: sanitizeText(row["Lead ID"]),
    lead_created_at: parseDate(row["Lead Created Date"]),
    date_added: parseDate(row["Date Added"]),
    website: sanitizeText(row["Website"]),
    company: sanitizeText(row["Company"]),
    business_name: sanitizeText(row["Company"]) || sanitizeText(row["Business Name"]),
    unsubscribed_email:
      row["Unsubscribed Email"] === true ||
      String(row["Unsubscribed Email"] || "").toLowerCase() === "true",
    primary_user_assigned: sanitizeText(row["Primary User Assigned"]),
    last_appointment: parseDate(row["Last Appointment"]),
    last_service: parseDate(row["Last Service"]),
    tags: sanitizeText(row["Tags"]),
    source: sanitizeText(row["Source"]),
    pnl: sanitizeText(row["P&L"]),
    notes: sanitizeText(row["Notes"]),
    first_name: sanitizeText(row["First Name"]),
    last_name: sanitizeText(row["Last Name"]),
    email: sanitizeText(row["Email"]),
    address1: sanitizeText(row["Address"]),
    address2: sanitizeText(row["Address 2"]),
    city: sanitizeText(row["City"]),
    state: sanitizeText(row["State/Province"]),
    zip: sanitizeText(row["Zip/Postal Code"]),
    country: sanitizeText(row["Country"]),
    phone_raw: phoneRaw,
    phone_e164: normalizedPhone.valid ? normalizedPhone.e164 : null,
    phone_display: normalizedPhone.valid ? normalizedPhone.display : null,
    legacy_phone: normalizedPhone.valid ? normalizedPhone.e164 : null,
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

  let values = columns.map((c) => payload[c] ?? null);
  values = values.map((v) =>
    typeof v === "string" && v.trim() === "" ? null : v
  );

  const placeholders = columns.map((_, i) => `$${i + 1}`);

  const dateCols = new Set([
    "lead_created_at",
    "date_added",
    "last_appointment",
    "last_service",
  ]);
  const boolCols = new Set(["unsubscribed_email"]);

  const updateAssignments = columns
    .filter((c) => c !== "legacy_client_id")
    .map((c) => {
      if (dateCols.has(c) || boolCols.has(c)) {
        return `"${c}" = COALESCE(EXCLUDED."${c}", c."${c}")`;
      }
      if (c === "phone_raw") {
        return `"${c}" = COALESCE(EXCLUDED."${c}", c."${c}")`;
      }
      return `"${c}" = COALESCE(NULLIF(EXCLUDED."${c}", ''), c."${c}")`;
    })
    .concat(["updated_at = NOW()"]);

  const sql = `
    INSERT INTO par.customers AS c (${columns.map((c) => `"${c}"`).join(", ")})
    VALUES (${placeholders.join(", ")})
    ON CONFLICT (legacy_client_id) DO UPDATE SET
      ${updateAssignments.join(", ")}
    RETURNING c.id;
  `;

  const { rows } = await pool.query(sql, values);
  return { customerId: rows[0].id, phoneValid: normalizedPhone.valid };
}

async function upsertVehicle(row, customerId) {
  const vin = sanitizeText(row["VIN"]);
  if (!vin || vin.length !== 17) return;

  const sql = `
    INSERT INTO par.vehicles (
      vin, customer_id, year, make, model, trim,
      odometer, plate_number, color, vehicle_notes
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    ON CONFLICT (vin) DO UPDATE SET
      customer_id = EXCLUDED.customer_id,
      year = COALESCE(EXCLUDED.year, vehicles.year),
      make = COALESCE(EXCLUDED.make, vehicles.make),
      model = COALESCE(EXCLUDED.model, vehicles.model),
      trim = COALESCE(EXCLUDED.trim, vehicles.trim),
      odometer = COALESCE(EXCLUDED.odometer, vehicles.odometer),
      plate_number = COALESCE(EXCLUDED.plate_number, vehicles.plate_number),
      color = COALESCE(EXCLUDED.color, vehicles.color),
      vehicle_notes = COALESCE(EXCLUDED.vehicle_notes, vehicles.vehicle_notes),
      updated_at = NOW();
  `;

  await pool.query(sql, [
    vin.toUpperCase(),
    customerId,
    parseInt(row["Year"], 10) || null,
    sanitizeText(row["Make"]),
    sanitizeText(row["Model"]),
    sanitizeText(row["Trim"]),
    parseInt(row["Odometer"], 10) || null,
    sanitizeText(row["Plate"]),
    sanitizeText(row["Color"]),
    sanitizeText(row["Vehicle Notes"]),
  ]);
}

async function updateDealerFlags() {
  await pool.query(`
    UPDATE par.customers c
    SET is_dealer = TRUE
    FROM (
      SELECT customer_id
      FROM par.vehicles
      GROUP BY customer_id
      HAVING COUNT(*) >= 10
    ) v
    WHERE c.id = v.customer_id
      AND c.is_dealer = FALSE;
  `);
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) usage();

  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error("File not found");

  const legacyPhoneColumn = await getLegacyPhoneColumn();

  const workbook = XLSX.readFile(resolved, { cellDates: true });
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    defval: null,
  });

  for (const row of rows) {
    const result = await upsertCustomer(row, legacyPhoneColumn);
    if (result?.customerId) {
      await upsertVehicle(row, result.customerId);
    }
  }

  await updateDealerFlags();
  console.log("Import complete");
}

main()
  .catch((e) => {
    console.error("Import failed:", e.message);
    process.exit(1);
  })
  .finally(() => pool.end());
