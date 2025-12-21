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

    if (!result.rows || !result.rows.length) {
      console.log("No schema information found.");
      return;
    }

    const grouped = result.rows.reduce((acc, row) => {
      const table = row.table_name;
      if (!acc[table]) acc[table] = [];
      acc[table].push(row);
      return acc;
    }, {});

    Object.keys(grouped).forEach((table) => {
      console.log(`\nTable: ${table}`);
      grouped[table].forEach((col) => {
        console.log(
          `  ${col.ordinal_position}. ${col.column_name} (${col.data_type}) nullable=${col.is_nullable}`
        );
      });
    });
  } catch (err) {
    console.error("Failed to fetch schema:", err.message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
