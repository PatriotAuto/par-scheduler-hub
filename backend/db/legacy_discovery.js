const IGNORED_TABLES = new Set(["pgmigrations", "pgmigrations_lock"]);
const DEFAULT_SCHEMA = "public";

function quoteIdent(name = "") {
  return `"${String(name).replace(/"/g, '""')}"`;
}

async function listTables(client, schema = DEFAULT_SCHEMA) {
  const { rows } = await client.query(
    `
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = $1
       AND table_type = 'BASE TABLE'
       AND table_name NOT IN (${Array.from(IGNORED_TABLES).map((_, idx) => `$${idx + 2}`).join(", ") || "'__none__'"})
     ORDER BY table_name
    `,
    [schema, ...Array.from(IGNORED_TABLES)]
  );
  return rows.map((r) => r.table_name);
}

async function fetchColumns(client, tableName, schema = DEFAULT_SCHEMA) {
  const { rows } = await client.query(
    `
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = $1
       AND table_name = $2
     ORDER BY ordinal_position
    `,
    [schema, tableName]
  );
  return rows.map((r) => r.column_name);
}

async function findTableByHint(client, hints, schema = DEFAULT_SCHEMA) {
  const tables = await listTables(client, schema);
  const lowered = tables.map((t) => t.toLowerCase());
  const normalizedHints = hints.map((h) => h.toLowerCase());

  const exact = normalizedHints.find((hint) => lowered.includes(hint));
  if (exact) return tables[lowered.indexOf(exact)];

  const fuzzy = tables.find((t) => normalizedHints.some((hint) => t.toLowerCase().includes(hint)));
  return fuzzy || null;
}

function findColumn(columns = [], candidates = []) {
  const lowered = columns.map((c) => c.toLowerCase());
  for (const candidate of candidates) {
    const idx = lowered.indexOf(candidate.toLowerCase());
    if (idx !== -1) return columns[idx];
  }
  return null;
}

function buildRowAccessor(row = {}) {
  const map = new Map();
  Object.entries(row || {}).forEach(([key, value]) => {
    map.set(String(key).toLowerCase(), value);
  });

  return (candidates = []) => {
    for (const candidate of candidates) {
      const value = map.get(String(candidate).toLowerCase());
      if (value !== undefined) return value;
    }
    return undefined;
  };
}

module.exports = {
  buildRowAccessor,
  fetchColumns,
  findColumn,
  findTableByHint,
  listTables,
  quoteIdent,
};
