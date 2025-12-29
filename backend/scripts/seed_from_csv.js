/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const DATA_DIR = path.join(__dirname, "..", "data");

// Map the CSV file to table name (snake_case).
// If you rename a CSV later, update it here.
const FILES = [
  { file: "Departments.csv", table: "departments" },
  { file: "Services.csv", table: "services" },
  { file: "Employees.csv", table: "employees" },
  { file: "EmployeeSchedule.csv", table: "employee_schedule" },
  { file: "TechTimeOff.csv", table: "tech_time_off" },
  { file: "Holidays.csv", table: "holidays" },
  { file: "Customers.csv", table: "customers" },
  { file: "Leads.csv", table: "leads" },
  { file: "Users.csv", table: "users" },
  { file: "Appointments.csv", table: "appointments" },
];

// --- helpers ---
function listFilesCaseInsensitive(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".csv"));
}

function resolveCsvPath(dir, wantedName) {
  const files = listFilesCaseInsensitive(dir);
  const wanted = wantedName.toLowerCase();
  const match = files.find((f) => f.toLowerCase() === wanted);
  return match ? path.join(dir, match) : null;
}

function normalizeHeader(h) {
  // keep simple: trim, replace spaces with underscores, remove weird quotes
  return String(h || "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^\w]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function dedupeHeaders(headers) {
  const seen = new Map();
  return headers.map((h) => {
    const base = normalizeHeader(h);
    const count = (seen.get(base) || 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

function parseCsvRaw(csvText) {
  // Minimal CSV parser good for your exports (comma + quotes)
  // If you later get super complex CSVs, we can switch to a library.
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i++) {
    const ch = csvText[i];
    const next = csvText[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(cur);
        cur = "";
      } else if (ch === "\n") {
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else if (ch === "\r") {
        // ignore
      } else {
        cur += ch;
      }
    }
  }

  // last cell
  row.push(cur);
  rows.push(row);

  // remove trailing blank row if present
  while (rows.length && rows[rows.length - 1].every((v) => String(v || "").trim() === "")) {
    rows.pop();
  }
  return rows;
}

function isIdLikeColumn(colName) {
  const c = String(colName || "").toLowerCase();
  return c === "id" || c.endsWith("id");
}

function qIdent(s) {
  // safe identifier quoting for Postgres
  return `"${String(s).replace(/"/g, '""')}"`;
}

async function createTableFromHeaders(client, table, headers) {
  if (!headers.length) return;

  const pk = isIdLikeColumn(headers[0]) ? headers[0] : null;

  const colsSql = headers.map((h) => {
    // all TEXT for now (safe)
    const base = `${qIdent(h)} TEXT`;
    // If first col is id-like, set as primary key
    if (pk && h === pk) return `${base} PRIMARY KEY`;
    return base;
  });

  const sql = `CREATE TABLE IF NOT EXISTS ${qIdent(table)} (
  ${colsSql.join(",\n  ")}
);`;
  await client.query(sql);
}

async function truncateTable(client, table) {
  await client.query(`TRUNCATE TABLE ${qIdent(table)};`);
}

async function insertRows(client, table, headers, rows) {
  if (!rows.length) return;

  const cols = headers.map(qIdent).join(", ");
  const placeholders = headers.map((_, i) => `$${i + 1}`).join(", ");
  const sql = `INSERT INTO ${qIdent(table)} (${cols}) VALUES (${placeholders});`;

  // insert in batches
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    // Use a transaction per chunk
    await client.query("BEGIN");
    try {
      for (const r of chunk) {
        const vals = headers.map((_, idx) => {
          const v = r[idx] ?? "";
          const t = String(v);
          return t === "" ? null : t;
        });
        await client.query(sql, vals);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }
}

async function seedOne(client, csvPath, table) {
  const raw = fs.readFileSync(csvPath, "utf8");
  const parsed = parseCsvRaw(raw);

  if (!parsed.length) {
    console.log(`No rows in ${path.basename(csvPath)}; skipping`);
    return { table, inserted: 0 };
  }

  const rawHeaders = parsed[0];
  const headers = dedupeHeaders(rawHeaders);

  const dataRows = parsed.slice(1).filter((r) => r.some((v) => String(v || "").trim() !== ""));
  // normalize row lengths
  const rows = dataRows.map((r) => {
    const out = headers.map((_, i) => (r[i] ?? ""));
    return out;
  });

  await createTableFromHeaders(client, table, headers);
  await truncateTable(client, table);

  if (rows.length) {
    await insertRows(client, table, headers, rows);
  }

  console.log(`Seeded ${table}: ${rows.length} rows`);
  return { table, inserted: rows.length };
}

// ---- main ----
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Missing DATABASE_URL env var");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: url,
    ssl: url ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  try {
    console.log("Seeding from:", DATA_DIR);
    const summary = [];

    for (const entry of FILES) {
      const csvPath = resolveCsvPath(DATA_DIR, entry.file);
      if (!csvPath) {
        console.log(`Skipping missing file: ${entry.file}`);
        continue;
      }
      summary.push(await seedOne(client, csvPath, entry.table));
    }

    console.log("Seed summary:", summary);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error("Seeding failed:", e);
  process.exit(1);
});
