// CSV-to-Postgres seeder
// Put CSV files in ./data and run: npm run seed
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { Pool } = require("pg");

const DATA_DIR = path.join(__dirname, "..", "data");
const CSV_FILES = [
  "Departments.csv",
  "Services.csv",
  "Employees.csv",
  "EmployeeSchedule.csv",
  "TechTimeOff.csv",
  "Holidays.csv",
  "Customers.csv",
  "Leads.csv",
  "Users.csv",
  "Appointments.csv",
];

function qIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function toTableName(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  return `raw_${base.toLowerCase()}`;
}

async function createTable(client, tableName, headers) {
  const columnDefs = headers.map((h) => `${qIdent(h)} text`).join(",\n  ");
  const createSql = `CREATE TABLE IF NOT EXISTS ${qIdent(tableName)} (
  id bigserial PRIMARY KEY,
  ${qIdent("_imported_at")} timestamptz DEFAULT now(),
  ${columnDefs}
)`;
  await client.query(createSql);
}

function readCsv(filePath) {
  const content = fs.readFileSync(filePath);
  const headerRow = parse(content, { to_line: 1 })[0] || [];
  const headers = headerRow.map((h) => h);
  const rows = parse(content, {
    columns: headers,
    from_line: 2,
    skip_empty_lines: true,
  });
  return { headers, rows };
}

async function seedFile(client, fileName) {
  const fullPath = path.join(DATA_DIR, fileName);
  if (!fs.existsSync(fullPath)) {
    console.log(`Skipping missing file: ${fileName}`);
    return { table: toTableName(fileName), imported: 0, skipped: true };
  }

  const { headers, rows } = readCsv(fullPath);
  if (!headers.length) {
    console.log(`No headers found in ${fileName}, skipping.`);
    return { table: toTableName(fileName), imported: 0, skipped: true };
  }

  const tableName = toTableName(fileName);
  await createTable(client, tableName, headers);
  await client.query(`TRUNCATE TABLE ${qIdent(tableName)} RESTART IDENTITY`);

  if (!rows.length) {
    console.log(`No data rows in ${fileName}, table truncated.`);
    return { table: tableName, imported: 0, skipped: false };
  }

  const colList = headers.map((h) => qIdent(h)).join(", ");
  const placeholders = headers.map((_, idx) => `$${idx + 1}`).join(", ");
  const insertSql = `INSERT INTO ${qIdent(tableName)} (${colList}) VALUES (${placeholders})`;

  for (const row of rows) {
    const values = headers.map((h) => {
      const v = row[h];
      return v === undefined || v === "" ? null : String(v);
    });
    await client.query(insertSql, values);
  }

  return { table: tableName, imported: rows.length, skipped: false };
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const results = [];
    for (const file of CSV_FILES) {
      const result = await seedFile(client, file);
      results.push(result);
    }
    await client.query("COMMIT");

    console.log("Seed summary:");
    for (const r of results) {
      if (r.skipped) {
        console.log(`- ${r.table}: skipped`);
      } else {
        console.log(`- ${r.table}: ${r.imported} rows`);
      }
    }
    process.exit(0);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seeding failed:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
