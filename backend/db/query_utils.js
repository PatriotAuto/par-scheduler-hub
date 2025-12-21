function getTableColumns(schemaJson = {}, tableName = "") {
  if (!tableName) return new Set();
  const cols = schemaJson[tableName] || [];
  return new Set(cols);
}

function safeSelectAll(tableName) {
  return `SELECT * FROM ${tableName}`;
}

function safeOrderBy(tableName, preferredOrderColumns = [], schemaJson = {}, direction = "ASC") {
  const columns = getTableColumns(schemaJson, tableName);
  let orderColumn = preferredOrderColumns.find((col) => columns.has(col));

  if (!orderColumn && columns.has("id")) {
    orderColumn = "id";
  }

  if (!orderColumn) return "";

  const dir = String(direction || "ASC").toUpperCase() === "DESC" ? "DESC" : "ASC";
  return ` ORDER BY ${orderColumn} ${dir}`;
}

function safeSearchWhere(tableName, preferredSearchColumns = [], searchTerm = "", paramIndexStart = 1, schemaJson = {}) {
  const columns = getTableColumns(schemaJson, tableName);
  const searchable = preferredSearchColumns.filter((col) => columns.has(col));

  if (!searchTerm || !searchable.length) {
    return { clause: "", params: [], nextIndex: paramIndexStart };
  }

  const placeholder = `$${paramIndexStart}`;
  const expressions = searchable.map((col) => `${col} ILIKE ${placeholder}`);
  return {
    clause: `(${expressions.join(" OR ")})`,
    params: [`%${searchTerm}%`],
    nextIndex: paramIndexStart + 1,
  };
}

module.exports = {
  getTableColumns,
  safeSelectAll,
  safeOrderBy,
  safeSearchWhere,
};
