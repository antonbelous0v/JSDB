import { DataType } from "../constants.js"
import { SqlError } from "../errors.js"
import { ExpressionBinder } from "./expression_binder.js"

const TYPE_MAP = {
  BOOLEAN: DataType.BOOLEAN,
  INT: DataType.INT32,
  INTEGER: DataType.INT32,
  BIGINT: DataType.INT64,
  FLOAT: DataType.FLOAT64,
  REAL: DataType.FLOAT64,
  TEXT: DataType.TEXT,
  TIMESTAMP: DataType.TIMESTAMP,
}

export class Binder {
  constructor(catalog) {
    this.catalog = catalog
    this.expressions = new ExpressionBinder()
  }

  bind(statement) {
    switch (statement.type) {
      case "create_table":
        return this.bindCreateTable(statement)
      case "insert":
      case "update":
      case "delete":
        return this.bindMutation(statement)
      case "select":
        return this.bindSelect(statement)
      case "explain":
        return { ...statement, statement: this.bind(statement.statement) }
      case "create_index":
        this.bindIndex(statement)
    }
    return statement
  }

  bindIndex(statement) {
    const table = this.catalog.getTable(statement.table)
    for (const column of statement.columns) {
      table.schema.indexOf(column)
    }
  }

  bindCreateTable(statement) {
    return {
      ...statement,
      columns: statement.columns.map((column) => {
        const dataType = TYPE_MAP[column.dataType]
        if (!dataType) {
          throw new SqlError(`Unsupported data type ${column.dataType}`)
        }
        return { ...column, dataType }
      }),
    }
  }

  bindMutation(statement) {
    const table = this.catalog.getTable(statement.table)
    if (statement.columns) {
      for (const column of statement.columns) {
        table.schema.indexOf(column)
      }
    }
    if (statement.assignments) {
      for (const assignment of statement.assignments) {
        table.schema.indexOf(assignment.column)
        this.expressions.bind(assignment.value, [{ name: table.schema.name, alias: table.schema.name, schema: table.schema }])
      }
    }
    if (statement.where) {
      this.expressions.bind(statement.where, [{ name: table.schema.name, alias: table.schema.name, schema: table.schema }])
    }
    return { ...statement, metadata: table }
  }

  bindSelect(statement) {
    const references = [statement.from, ...statement.joins.map(join => join.table)].map((reference) => {
      const table = this.catalog.getTable(reference.name)
      return { name: reference.name, alias: reference.alias ?? reference.name, schema: table.schema, metadata: table }
    })
    for (const item of statement.columns) {
      this.expressions.bind(item.expression, references)
    }
    for (const join of statement.joins) {
      this.expressions.bind(join.on, references)
    }
    if (statement.where) {
      this.expressions.bind(statement.where, references)
    }
    for (const item of statement.orderBy) {
      this.expressions.bind(item.expression, references)
    }
    return { ...statement, references }
  }
}
