import { compileRowExpression, evaluate, evaluateRow } from "../executor/expression.js"
import { DataType } from "../constants.js"

function convert(value, type) {
  if (value === null) {
    return null
  }
  if (type === DataType.INT32 || type === DataType.FLOAT64) {
    return Number(value)
  }
  if (type === DataType.INT64 || type === DataType.TIMESTAMP) {
    return BigInt(value)
  }
  return value
}

function indexedItems(table, condition, transaction) {
  if (!condition || condition.type !== "binary" || condition.operator !== "=") {
    return null
  }
  const column = condition.left.type === "column" && condition.right.type === "literal"
    ? condition.left
    : condition.right.type === "column" && condition.left.type === "literal" ? condition.right : null
  const literal = condition.left.type === "literal"
    ? condition.left
    : condition.right.type === "literal" ? condition.right : null
  if (!column || !literal) {
    return null
  }
  const name = table.schema.columns[column.binding.index].name
  for (const { definition } of table.indexes.values()) {
    if (definition.columns.length === 1 && definition.columns[0] === name) {
      return table.lookup(definition.name, literal.value, transaction)
    }
  }
  return null
}

export class MutationExecutor {
  constructor(catalog, tables) {
    this.catalog = catalog
    this.tables = tables
  }

  insert(statement, transaction) {
    const table = this.tables.table(statement.table)
    const schema = table.schema
    const columnIndexes = statement.columns
      ? statement.columns.map(column => schema.indexOf(column))
      : schema.columns.map((_, index) => index)
    for (const values of statement.values) {
      const row = new Array(schema.columns.length)
      for (let index = 0; index < schema.columns.length; index += 1) {
        row[index] = schema.columns[index].defaultValue
      }
      for (let index = 0; index < values.length; index += 1) {
        const columnIndex = columnIndexes[index]
        row[columnIndex] = convert(evaluate(values[index], {}), schema.columns[columnIndex].type)
      }
      table.insertRow(row, transaction)
    }
    this.catalog.markDirty()
    return { status: "INSERT", rows: statement.values.length }
  }

  update(statement, transaction) {
    const table = this.tables.table(statement.table)
    const assignments = statement.assignments.map((assignment) => {
      const index = table.schema.indexOf(assignment.column)
      return { expression: assignment.value, index, type: table.schema.columns[index].type }
    })
    const predicate = statement.where ? compileRowExpression(statement.where) : () => true
    const update = (row) => {
      for (let index = 0; index < assignments.length; index += 1) {
        const assignment = assignments[index]
        row[assignment.index] = convert(evaluateRow(assignment.expression, row), assignment.type)
      }
    }
    const candidates = indexedItems(table, statement.where, transaction)
    const rows = table.updateWhere(predicate, update, transaction, candidates)
    if (rows) {
      this.catalog.markDirty()
    }
    return { status: "UPDATE", rows }
  }

  delete(statement, transaction) {
    const table = this.tables.table(statement.table)
    const predicate = statement.where ? compileRowExpression(statement.where) : () => true
    const candidates = indexedItems(table, statement.where, transaction)
    return { status: "DELETE", rows: table.deleteWhere(predicate, transaction, candidates) }
  }
}
