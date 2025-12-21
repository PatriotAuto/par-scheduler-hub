const schemaCache = {
  schema: {},
  loaded: false,
  loadingPromise: null,
};

async function loadSchemaCache(pool) {
  if (schemaCache.loadingPromise) return schemaCache.loadingPromise;

  const sql = `
    SELECT table_name, column_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
     ORDER BY table_name, ordinal_position
  `;

  schemaCache.loadingPromise = (async () => {
    const result = await pool.query(sql);
    const map = {};
    for (const row of result.rows || []) {
      const table = row.table_name;
      const column = row.column_name;
      if (!map[table]) map[table] = [];
      map[table].push(column);
    }
    schemaCache.schema = map;
    schemaCache.loaded = true;
    return map;
  })().catch((err) => {
    schemaCache.loaded = false;
    schemaCache.loadingPromise = null;
    throw err;
  });

  return schemaCache.loadingPromise;
}

function getSchema() {
  return schemaCache.schema;
}

function getTableColumns(tableName) {
  const cols = schemaCache.schema[tableName] || [];
  return new Set(cols);
}

module.exports = {
  loadSchemaCache,
  getSchema,
  getTableColumns,
};
