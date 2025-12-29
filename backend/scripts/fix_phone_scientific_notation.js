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

function cleanRawInput(value) {
  if (value === null || value === undefined) return "";
  let s = String(value).trim();
  if (!s) return "";

  if (/[eE]\+?\d+/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = Math.trunc(n).toString();
  }

  const digits = s.replace(/\D/g, "");
  return digits.length ? digits : s;
}

async function main() {
  console.log("Connecting to Postgres...");
  const legacyPhoneColumn = await getLegacyPhoneColumn();
  const quotedLegacyPhone = quoteIdentifier(legacyPhoneColumn);
  console.log("Legacy phone column:", legacyPhoneColumn);

  const selectSql = `
    SELECT id, phone_raw, phone_display, phone_e164, phone, ${quotedLegacyPhone} AS legacy_phone
    FROM par.customers
    WHERE
      phone_raw ILIKE '%e%' OR
      phone_display ILIKE '%e%' OR
      phone_e164 ILIKE '%e%' OR
      ${quotedLegacyPhone}::text ILIKE '%e%' OR
      phone ILIKE '%e%' OR
      (phone_raw ~ '^[0-9.,+\-eE ]+$' AND length(regexp_replace(phone_raw, '\\D', '', 'g')) > 0 AND length(regexp_replace(phone_raw, '\\D', '', 'g')) < 10)
    ORDER BY id ASC;
  `;

  const { rows } = await pool.query(selectSql);
  console.log("Rows needing review:", rows.length);

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const sourceCandidates = [
      row.phone_raw,
      row.phone_display,
      row.phone_e164,
      row.legacy_phone,
      row.phone,
    ];

    const sourcePhone = sourceCandidates.find((v) => v !== null && v !== undefined && String(v).trim() !== "");
    if (!sourcePhone) {
      skipped += 1;
      continue;
    }

    const cleaned = cleanRawInput(sourcePhone);
    const normalized = normalizeUSPhone(cleaned);

    const updates = [];
    const params = [];

    if (cleaned && cleaned !== row.phone_raw) {
      params.push(cleaned);
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

    if (row.legacy_phone !== undefined && normalized.e164 !== row.legacy_phone) {
      params.push(normalized.e164);
      updates.push(`${quotedLegacyPhone} = $${params.length}`);
    }

    const existingPhone = row.phone;
    let newPhoneValue = normalized.e164 || normalized.display || cleaned || null;
    if (existingPhone && typeof existingPhone === "string" && existingPhone.includes("-")) {
      newPhoneValue = normalized.display || normalized.e164 || cleaned || existingPhone;
    }

    if (newPhoneValue !== existingPhone) {
      params.push(newPhoneValue);
      updates.push(`phone = $${params.length}`);
    }

    if (!updates.length) {
      skipped += 1;
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

  console.log("Cleanup complete.");
  console.log("Rows processed:", rows.length);
  console.log("Updated:", updated);
  console.log("Skipped/no change:", skipped);
}

main()
  .catch((err) => {
    console.error("Error fixing scientific notation phones:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
