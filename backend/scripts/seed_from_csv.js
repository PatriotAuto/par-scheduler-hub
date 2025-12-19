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

function normalizeColName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\uFEFF/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function dedupeCols(cols) {
  const seen = new Map();
  return cols.map((c) => {
    let col = c;
    if (!seen.has(col)) {
      seen.set(col, 1);
      return col;
    }
    const n = seen.get(col) + 1;
    seen.set(col, n);
    return `${col}_${n}`;
  });
}

const FILE_MAP = {
  "Appointments.csv": "Patriot Scheduler – Backend - Appointments.csv",
  "Customers.csv": "Patriot Scheduler – Backend - Customers.csv",
  "Departments.csv": "Patriot Scheduler – Backend - Departments.csv",
  "Employees.csv": "Patriot Scheduler – Backend - Employees.csv",
  "EmployeeSchedule.csv": "Patriot Scheduler – Backend - EmployeeSchedule.csv",
  "Holidays.csv": "Patriot Scheduler – Backend - Holidays.csv",
  "Leads.csv": "Patriot Scheduler – Backend - Leads.csv",
  "Services.csv": "Patriot Scheduler – Backend - Services.csv",
  "TechTimeOff.csv": "Patriot Scheduler – Backend - TechTimeOff.csv",
  "Users.csv": "Patriot Scheduler – Backend - Users.csv",
};

function resolveCsvPath(fileName) {
  const p1 = path.join(DATA_DIR, fileName);
  if (fs.existsSync(p1)) return p1;

  // fallback: repo root (in case someone placed CSVs there)
  const p2 = path.join(__dirname, "..", fileName);
  if (fs.existsSync(p2)) return p2;

  return null;
}

function qIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function toTableName(fileName) {
  const base = path.basename(fileName, path.extname(fileName));
  return `raw_${base.toLowerCase()}`;
}

async function createTable(client, tableName, headers) {
  // Normalize headers
  const rawHeaders = (headers || []).map((h) => String(h || "").trim()).filter(Boolean);
  let cols = rawHeaders.map(normalizeColName).filter(Boolean);

  // De-dupe any repeated header names after normalization
  cols = dedupeCols(cols);

  // If CSV already has an id column, do NOT auto-add one.
  const hasId = cols.includes("id");

  const colDefs = [];
  if (!hasId) {
    colDefs.push(`id BIGSERIAL PRIMARY KEY`);
  }

  // create all csv columns as TEXT (simple and safe)
  for (const c of cols) {
    // skip because we already added it as PK
    if (!hasId && c === "id") continue;
    // if CSV has id, keep it as TEXT and NOT PK for now (can evolve later)
    colDefs.push(`"${c}" TEXT`);
  }

  const sql = `
    CREATE TABLE IF NOT EXISTS "${tableName}" (
      ${colDefs.join(",\n      ")}
    );
  `;
  await client.query(sql);
}

function readCsv(filePath) {
  const content = fs.readFileSync(filePath);
  const headerRow = parse(content, { to_line: 1 })[0] || [];
  const headers = headerRow.map((h) => String(h || "").trim());
  const rows = parse(content, {
    columns: headers,
    from_line: 2,
    skip_empty_lines: true,
  });
  return { headers, rows };
}

function prepareColumns(headers) {
  const prepared = [];
  for (const h of headers || []) {
    const raw = String(h || "").trim();
    if (!raw) continue;
    const normalized = normalizeColName(raw);
    if (!normalized) continue;
    prepared.push({ raw, normalized });
  }
  const normalized = dedupeCols(prepared.map((p) => p.normalized));
  return prepared.map((p, idx) => ({
    raw: p.raw,
    normalized: normalized[idx],
  }));
}

async function seedFile(client, fileName) {
  const mapped = FILE_MAP[fileName] || fileName;
  const resolved = resolveCsvPath(mapped);
  if (!resolved) {
    console.log(`Skipping missing file: ${mapped}`);
    return { table: toTableName(fileName), imported: 0, skipped: true };
  }

  console.log("Seeding from:", resolved);

  const { headers, rows } = readCsv(resolved);
  if (!headers.length) {
    console.log(`No headers found in ${fileName}, skipping.`);
    return { table: toTableName(fileName), imported: 0, skipped: true };
  }

  const columnPairs = prepareColumns(headers);
  const normalizedHeaders = columnPairs.map((c) => c.normalized);

  const tableName = toTableName(fileName);
  await createTable(client, tableName, normalizedHeaders);

  if (!rows.length) {
    console.log(`No data rows in ${fileName}, skipping (no truncate).`);
    return { table: tableName, imported: 0, skipped: true };
  }

  await client.query(`TRUNCATE TABLE ${qIdent(tableName)} RESTART IDENTITY`);

  const colList = columnPairs.map((c) => qIdent(c.normalized)).join(", ");
  const placeholders = columnPairs.map((_, idx) => `$${idx + 1}`).join(", ");
  const insertSql = `INSERT INTO ${qIdent(tableName)} (${colList}) VALUES (${placeholders})`;

  for (const row of rows) {
    const values = columnPairs.map((c) => {
      const v = row[c.raw];
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
