const { Pool } = require("pg");

const DB_URL = process.env.DATABASE_URL || "";
const needsSSL = DB_URL && !DB_URL.includes(".railway.internal") && !DB_URL.includes("railway.internal");
const sslConfig = needsSSL ? { rejectUnauthorized: false } : false;

const pool = new Pool({
  connectionString: DB_URL,
  ssl: sslConfig,
  connectionTimeoutMillis: 8000,
});

async function main() {
  console.log("Cleaning placeholder and invalid phone_raw values...");

  const clearedPlaceholder = await pool.query(`
    UPDATE par.customers
    SET phone_raw = NULL
    WHERE phone_raw IS NOT NULL
      AND lower(trim(phone_raw)) IN ('null', 'none', 'n/a', 'na', '-', '.')
    RETURNING id;
  `);

  console.log("Cleared placeholder phone_raw rows:", clearedPlaceholder.rowCount);

  const clearedTooShort = await pool.query(`
    UPDATE par.customers
    SET phone_raw = NULL
    WHERE phone_raw IS NOT NULL
      AND regexp_replace(phone_raw, '\\D', '', 'g') ~ '^[0-9]{0,9}$'
    RETURNING id;
  `);

  console.log("Cleared too-short phone_raw rows:", clearedTooShort.rowCount);

  const clearedInvalidLong = await pool.query(`
    UPDATE par.customers
    SET phone_raw = NULL
    WHERE phone_raw IS NOT NULL
      AND regexp_replace(phone_raw, '\\D', '', 'g') ~ '^[0-9]{11,}$'
      AND regexp_replace(phone_raw, '\\D', '', 'g') !~ '^1[0-9]{10}$'
    RETURNING id;
  `);

  console.log("Cleared invalid-long phone_raw rows:", clearedInvalidLong.rowCount);
}

main()
  .catch((err) => {
    console.error("Error cleaning customer phone_raw values:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
