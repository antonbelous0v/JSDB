import { evaluate, evaluateRow, sqlBoolean } from "./expression.js"
import { SqlError } from "../errors.js"

export function sequenceScan(table, reference, transaction) {
  const source = table.scan(transaction)
  const rows = new Array(source.length)
  for (let index = 0; index < source.length; index += 1) {
    rows[index] = { [reference.alias]: source[index].row }
  }
  return rows
}

export function indexScan(table, reference, index, key, transaction) {
  const source = table.lookup(index, key, transaction)
  const rows = new Array(source.length)
  for (let position = 0; position < source.length; position += 1) {
    rows[position] = { [reference.alias]: source[position].row }
  }
  return rows
}

export function indexScanProject(table, index, key, transaction, columns) {
  const source = table.lookup(index, key, transaction)
  const rows = new Array(source.length)
  const star = columns.length === 1 && columns[0].expression.type === "star"
  const columnIndexes = projectionIndexes(columns)
  for (let position = 0; position < source.length; position += 1) {
    const row = source[position].row
    rows[position] = star ? row.slice() : projectRow(row, columns, columnIndexes)
  }
  return rows
}

export function limitedSequenceScan(table, reference, transaction, condition, limit) {
  const rows = []
  table.forEach(transaction, (item) => {
    const context = { [reference.alias]: item.row }
    if (sqlBoolean(evaluate(condition, context))) {
      rows[rows.length] = context
    }
    return rows.length < limit
  })
  return rows
}

export function scanProject(table, transaction, columns, condition = null, limit = Infinity) {
  const rows = []
  const star = columns.length === 1 && columns[0].expression.type === "star"
  const columnIndexes = star ? null : projectionIndexes(columns)
  table.forEachRow(transaction, (source) => {
    if (condition && !sqlBoolean(evaluateRow(condition, source))) {
      return true
    }
    if (star) {
      rows[rows.length] = source.slice()
    } else {
      rows[rows.length] = projectRow(source, columns, columnIndexes)
    }
    return rows.length < limit
  })
  return rows
}

export function scanAggregate(table, transaction, columns, condition = null) {
  const countOperation = 0
  const minOperation = 1
  const maxOperation = 2
  const sumOperation = 3
  const averageOperation = 4
  const counts = new Float64Array(columns.length)
  const values = new Array(columns.length).fill(null)
  const operations = new Uint8Array(columns.length)
  const columnIndexes = new Int32Array(columns.length)
  columnIndexes.fill(-2)
  for (let index = 0; index < columns.length; index += 1) {
    const expression = columns[index].expression
    if (expression.type !== "call" || !["COUNT", "MIN", "MAX", "SUM", "AVG"].includes(expression.name)) {
      throw new SqlError(expression.type === "call" ? `Unknown aggregate ${expression.name}` : "Columns outside aggregate functions require GROUP BY")
    }
    operations[index] = expression.name === "COUNT" ? countOperation : expression.name === "MIN" ? minOperation : expression.name === "MAX" ? maxOperation : expression.name === "SUM" ? sumOperation : averageOperation
    const argument = expression.args[0]
    columnIndexes[index] = argument.type === "star" ? -1 : argument.type === "column" ? argument.binding.index : -2
  }
  table.forEachRow(transaction, (row) => {
    if (condition && !sqlBoolean(evaluateRow(condition, row))) {
      return true
    }
    for (let index = 0; index < columns.length; index += 1) {
      const columnIndex = columnIndexes[index]
      const value = columnIndex === -1 ? 1 : columnIndex >= 0 ? row[columnIndex] : evaluateRow(columns[index].expression.args[0], row)
      if (value === null) {
        continue
      }
      counts[index] += 1
      const operation = operations[index]
      const current = values[index]
      if (operation === minOperation) {
        values[index] = current === null || value < current ? value : current
      } else if (operation === maxOperation) {
        values[index] = current === null || value > current ? value : current
      } else if (operation === sumOperation || operation === averageOperation) {
        values[index] = current === null ? value : current + value
      }
    }
    return true
  })
  const result = new Array(columns.length)
  for (let index = 0; index < columns.length; index += 1) {
    const operation = operations[index]
    const count = counts[index]
    const value = values[index]
    if (operation === countOperation) {
      result[index] = BigInt(count)
    } else if (!count) {
      result[index] = null
    } else if (operation === averageOperation) {
      result[index] = typeof value === "bigint" ? Number(value) / count : value / count
    } else {
      result[index] = value
    }
  }
  return [result]
}

function projectionIndexes(columns) {
  const indexes = new Int32Array(columns.length)
  indexes.fill(-1)
  for (let index = 0; index < columns.length; index += 1) {
    const expression = columns[index].expression
    if (expression.type === "column") {
      indexes[index] = expression.binding.index
    }
  }
  return indexes
}

function projectRow(source, columns, columnIndexes) {
  const row = new Array(columns.length)
  for (let index = 0; index < columns.length; index += 1) {
    const columnIndex = columnIndexes[index]
    row[index] = columnIndex >= 0 ? source[columnIndex] : evaluateRow(columns[index].expression, source)
  }
  return row
}
