const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  });

  try {
    const sql = `
      SELECT table_name, column_name, data_type, is_nullable, ordinal_position
        FROM information_schema.columns
       WHERE table_schema='public'
       ORDER BY table_name, ordinal_position;
    `;
    const result = await pool.query(sql);
    const grouped = result.rows.reduce((acc, row) => {
      const table = row.table_name;
      if (!acc[table]) acc[table] = [];
      acc[table].push({
        column_name: row.column_name,
        data_type: row.data_type,
        is_nullable: row.is_nullable,
        ordinal_position: row.ordinal_position,
      });
      return acc;
    }, {});

    const outputPath = path.join("/tmp", "schema.json");
    fs.writeFileSync(outputPath, JSON.stringify(grouped, null, 2));
    console.log(`Schema written to ${outputPath}`);
    console.log(JSON.stringify(grouped, null, 2));
  } catch (err) {
    console.error("Failed to fetch schema:", err.message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
