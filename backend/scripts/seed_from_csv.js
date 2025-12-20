// CSV-to-Postgres seeder for Railway-compatible environments.
// Run with: npm run seed
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { Pool } = require("pg");

const DATA_DIR = path.join(__dirname, "../backend/data");
const FALLBACK_DATA_DIR = path.join(__dirname, "../data");
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

const BATCH_SIZE = 500;

function qIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

function normalizeColName(name) {
  return String(name || "")
    .replace(/\uFEFF/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function dedupeNames(names) {
  const seen = new Map();
  return names.map((n) => {
    const base = n || "column";
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    if (count === 0) return base;
    return `${base}_${count + 1}`;
  });
}

function inferColumnType(name) {
  if (name === "id") return "TEXT";

  if (/(_at)$/.test(name)) return "TIMESTAMP";
  if (name === "date" || /_date$/.test(name)) return "DATE";
  if (/(_minutes|_minute|_mins|_duration)$/.test(name)) return "INTEGER";
  if (/(price|amount)$/.test(name)) return "NUMERIC";
  if (/^(is_|has_)/.test(name)) return "BOOLEAN";

  return "TEXT";
}

function getDataDir() {
  if (fs.existsSync(DATA_DIR)) return DATA_DIR;
  if (fs.existsSync(FALLBACK_DATA_DIR)) return FALLBACK_DATA_DIR;
  throw new Error(`Data directory not found. Checked ${DATA_DIR} and ${FALLBACK_DATA_DIR}`);
}

function readCsv(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const headerRow = parse(content, { bom: true, to_line: 1 })[0] || [];
  const headers = headerRow.map((h) => String(h ?? "").trim());

  const rows = parse(content, {
    bom: true,
    columns: headers,
    from_line: 2,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: true,
  });

  return { headers, rows };
}

function buildColumns(headers) {
  const prepared = headers.map((h, idx) => {
    const raw = String(h ?? "").trim();
    const normalized = normalizeColName(raw) || `column_${idx + 1}`;
    return { raw, normalized };
  });

  const uniqueNames = dedupeNames(prepared.map((p) => p.normalized));
  return prepared.map((p, idx) => ({
    raw: p.raw,
    name: uniqueNames[idx],
    type: inferColumnType(uniqueNames[idx]),
  }));
}

async function createTable(client, tableName, columns) {
  const hasId = columns.some((c) => c.name === "id");
  const definitions = [];

  if (!hasId) {
    definitions.push("id SERIAL PRIMARY KEY");
  }

  for (const col of columns) {
    if (col.name === "id") {
      definitions.push(`${qIdent(col.name)} TEXT PRIMARY KEY`);
      continue;
    }
    definitions.push(`${qIdent(col.name)} ${col.type}`);
  }

  const createSql = `CREATE TABLE IF NOT EXISTS ${qIdent(tableName)} (
  ${definitions.join(",\n  ")}
);`;

  await client.query(createSql);
}

function toBoolean(value) {
  const val = String(value).toLowerCase();
  if (["true", "t", "1", "yes", "y"].includes(val)) return true;
  if (["false", "f", "0", "no", "n"].includes(val)) return false;
  return null;
}

function isValidDate(value) {
  return !Number.isNaN(Date.parse(value));
}

function convertValue(value, type) {
  if (value === undefined || value === null) return null;
  const trimmed = typeof value === "string" ? value.trim() : value;
  if (trimmed === "") return null;

  switch (type) {
    case "INTEGER": {
      const intVal = parseInt(trimmed, 10);
      return Number.isNaN(intVal) ? null : intVal;
    }
    case "NUMERIC": {
      const numVal = parseFloat(trimmed);
      return Number.isNaN(numVal) ? null : numVal;
    }
    case "BOOLEAN": {
      return toBoolean(trimmed);
    }
    case "DATE":
    case "TIMESTAMP": {
      return isValidDate(trimmed) ? trimmed : null;
    }
    default:
      return trimmed;
  }
}

async function insertRows(client, tableName, columns, rows) {
  if (!columns.length) return 0;

  const columnList = columns.map((c) => qIdent(c.name)).join(", ");
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const placeholders = [];
    const values = [];

    batch.forEach((row, rowIdx) => {
      const rowPlaceholders = columns.map((col, colIdx) => {
        const valueIndex = rowIdx * columns.length + colIdx + 1;
        values.push(convertValue(row[col.raw], col.type));
        return `$${valueIndex}`;
      });
      placeholders.push(`(${rowPlaceholders.join(", ")})`);
    });

    const insertSql = `INSERT INTO ${qIdent(tableName)} (${columnList}) VALUES ${placeholders.join(", ")}`;
    await client.query(insertSql, values);
    inserted += batch.length;
  }

  return inserted;
}

async function seedFile(client, { file, table }) {
  const dataDir = getDataDir();
  const filePath = path.join(dataDir, file);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing file: ${filePath}`);
  }

  console.log(`\nSeeding table ${table} from ${filePath}`);
  const { headers, rows } = readCsv(filePath);

  if (!headers.length) {
    throw new Error(`No headers found in ${file}`);
  }

  const columns = buildColumns(headers);
  await createTable(client, table, columns);

  await client.query(`TRUNCATE TABLE ${qIdent(table)} RESTART IDENTITY;`);

  if (!rows.length) {
    console.log(`- ${table}: no data rows found, table truncated.`);
    return { table, inserted: 0 };
  }

  const inserted = await insertRows(client, table, columns, rows);
  console.log(`- ${table}: inserted ${inserted} rows.`);

  return { table, inserted };
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();
  const results = [];

  try {
    for (const entry of FILES) {
      const result = await seedFile(client, entry);
      results.push(result);
    }

    console.log("\nSeed summary:");
    for (const { table, inserted } of results) {
      console.log(`- ${table}: ${inserted} rows inserted`);
    }
    process.exit(0);
  } catch (error) {
    console.error("\nSeeding failed:", error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
