const NUMERIC_TYPES = new Set(["INT32", "INT64", "FLOAT64", "INT", "INTEGER", "BIGINT", "FLOAT", "REAL"])

export function identifier(value) {
  return `"${String(value).replaceAll("\"", "\"\"")}"`
}

export function literal(value, type) {
  if (value === null || (value === "" && type !== "TEXT")) {
    return "NULL"
  }
  if (NUMERIC_TYPES.has(type)) {
    if (!/^-?(?:\d+|\d+\.\d+)$/.test(String(value))) {
      throw new Error(`${value} is not a valid number`)
    }
    return String(value)
  }
  if (type === "BOOLEAN") {
    return String(value).toUpperCase() === "TRUE" || value === true ? "TRUE" : "FALSE"
  }
  return `'${String(value).replaceAll("'", "''")}'`
}

export function createTableSql(name, columns) {
  if (!name.trim()) {
    throw new Error("Table name is required")
  }
  if (!columns.length) {
    throw new Error("Add at least one field")
  }
  const definitions = columns.map((column) => {
    if (!column.name.trim()) {
      throw new Error("Field name is required")
    }
    const constraints = `${column.primary ? " PRIMARY KEY" : ""}${column.nullable || column.primary ? "" : " NOT NULL"}`
    return `${identifier(column.name)} ${column.type}${constraints}`
  })
  return `CREATE TABLE ${identifier(name)} (${definitions.join(", ")});`
}

export function insertSql(table, fields, values) {
  const columns = fields.map(field => identifier(field.name)).join(", ")
  const row = fields.map(field => literal(values[field.name], field.type)).join(", ")
  return `INSERT INTO ${identifier(table)} (${columns}) VALUES (${row});`
}

export function updateSql(table, fields, values, primary, original) {
  const assignments = fields.map(field => `${identifier(field.name)} = ${literal(values[field.name], field.type)}`).join(", ")
  return `UPDATE ${identifier(table)} SET ${assignments} WHERE ${identifier(primary.name)} = ${literal(original[primary.name], primary.type)};`
}

export function deleteSql(table, primary, row) {
  return `DELETE FROM ${identifier(table)} WHERE ${identifier(primary.name)} = ${literal(row[primary.name], primary.type)};`
}
