import { evaluate } from "../executor/expression.js"
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

export class MutationExecutor {
  constructor(catalog, tables) {
    this.catalog = catalog
    this.tables = tables
  }

  insert(statement, transaction) {
    const table = this.tables.table(statement.table)
    const columns = statement.columns ?? table.schema.columns.map(column => column.name)
    for (const values of statement.values) {
      const input = Object.fromEntries(columns.map((column, index) => {
        const definition = table.schema.columns[table.schema.indexOf(column)]
        return [column, convert(evaluate(values[index], {}), definition.type)]
      }))
      table.insert(input, transaction)
    }
    this.catalog.markDirty()
    return { status: "INSERT", rows: statement.values.length }
  }

  update(statement, transaction) {
    const table = this.tables.table(statement.table)
    const predicate = row => !statement.where || evaluate(statement.where, { [statement.table]: row }) === true
    const changes = Object.fromEntries(statement.assignments.map(assignment => [assignment.column, (_, input) => {
      const column = table.schema.columns[table.schema.indexOf(assignment.column)]
      const row = table.schema.columns.map(definition => input[definition.name])
      return convert(evaluate(assignment.value, { [statement.table]: row }), column.type)
    }]))
    const rows = table.updateWhere(predicate, changes, transaction)
    if (rows) {
      this.catalog.markDirty()
    }
    return { status: "UPDATE", rows }
  }

  delete(statement, transaction) {
    const table = this.tables.table(statement.table)
    const predicate = row => !statement.where || evaluate(statement.where, { [statement.table]: row }) === true
    return { status: "DELETE", rows: table.deleteWhere(predicate, transaction) }
  }
}
