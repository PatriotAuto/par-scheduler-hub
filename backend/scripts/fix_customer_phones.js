const { Pool } = require("pg");
const { normalizeUSPhone } = require("../utils/phone");

const DB_URL = process.env.DATABASE_URL || "";
const needsSSL = DB_URL && !DB_URL.includes(".railway.internal") && !DB_URL.includes("railway.internal");
const sslConfig = needsSSL ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  connectionString: DB_URL,
  ssl: sslConfig,
  connectionTimeoutMillis: 8000,
});

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
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

function looksParseable(value) {
  if (!value && value !== 0) return false;
  const digits = String(value).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return true;
  return digits.length === 10;
}

function isZeroish(value) {
  if (!value) return false;
  const digits = String(value).replace(/\D/g, "");
  return /^\d{3}0{7}$/.test(digits) || /0{6,}/.test(digits);
}

async function main() {
  console.log("Connecting to Postgres...");
  const legacyPhoneColumn = await getLegacyPhoneColumn();
  const quotedLegacyPhone = quoteIdentifier(legacyPhoneColumn);
  console.log("Legacy phone column:", legacyPhoneColumn);

  const selectSql = `
    SELECT id, ${quotedLegacyPhone} AS legacy_phone, phone_e164, phone_display, phone_raw
    FROM par.customers
    ORDER BY id ASC
  `;

  const { rows } = await pool.query(selectSql);
  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  const invalidSamples = [];

  for (const row of rows) {
    scanned += 1;
    const legacyPhone = row.legacy_phone;
    const rawPhone = row.phone_raw;

    const legacyParseable = looksParseable(legacyPhone) || String(legacyPhone || "").startsWith("+1");
    const rawParseable = looksParseable(rawPhone) || String(rawPhone || "").startsWith("+1");
    const zeroishLegacy = isZeroish(legacyPhone);

    let sourcePhone = null;
    if (legacyParseable) {
      sourcePhone = legacyPhone;
    }
    if (!sourcePhone && rawParseable) {
      sourcePhone = rawPhone;
    }
    if (zeroishLegacy && rawParseable) {
      sourcePhone = rawPhone;
    }

    if (!sourcePhone) {
      skipped += 1;
      if (invalidSamples.length < 25) {
        invalidSamples.push({ id: row.id, legacy_phone: legacyPhone, phone_raw: rawPhone });
      }
      continue;
    }

    const normalized = normalizeUSPhone(sourcePhone);
    if (!normalized.valid) {
      skipped += 1;
      if (invalidSamples.length < 25) {
        invalidSamples.push({ id: row.id, legacy_phone: legacyPhone, phone_raw: rawPhone });
      }
      continue;
    }

    const updates = [];
    const params = [];

    const phoneRawValue = row.phone_raw ?? legacyPhone ?? null;
    if (phoneRawValue !== row.phone_raw) {
      params.push(phoneRawValue);
      updates.push(`phone_raw = $${params.length}`);
    }

    if (normalized.e164 !== row.phone_e164) {
      params.push(normalized.e164);
      updates.push(`phone_e164 = $${params.length}`);
    }

    if (normalized.display !== row.phone_display) {
      params.push(normalized.display);
      updates.push(`phone_display = $${params.length}`);
    }

    if (normalized.e164 !== legacyPhone) {
      params.push(normalized.e164);
      updates.push(`${quotedLegacyPhone} = $${params.length}`);
    }

    if (!updates.length) {
      continue;
    }

    updates.push("updated_at = NOW()");
    params.push(row.id);
    const updateSql = `UPDATE par.customers SET ${updates.join(", ")} WHERE id = $${params.length}`;

    try {
      await pool.query(updateSql, params);
      updated += 1;
    } catch (err) {
      console.error(`Failed to update customer ${row.id}:`, err.message || err);
    }
  }

  console.log("Scan complete.");
  console.log("Total customers scanned:", scanned);
  console.log("Updated:", updated);
  console.log("Skipped (invalid/unparseable):", skipped);
  console.log("Sample invalid/ambiguous records (up to 25):");
  console.log(JSON.stringify(invalidSamples, null, 2));
}

main()
  .catch((err) => {
    console.error("Error fixing customer phones:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
