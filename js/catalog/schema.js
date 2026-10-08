import { DataType } from "../constants.js"
import { ConstraintError, ValidationError } from "../errors.js"

const TYPES = new Set(Object.values(DataType))

export class Column {
  constructor({ name, type, nullable = true, defaultValue = null, references = null }) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new ValidationError(`Invalid column name ${name}`)
    }
    if (!TYPES.has(type) || type === DataType.NULL) {
      throw new ValidationError(`Invalid column type ${type}`)
    }
    this.name = name
    this.type = type
    this.nullable = nullable
    this.defaultValue = defaultValue
    this.references = references
  }
}

export class TableSchema {
  constructor({ name, columns, primaryKey = [], unique = [] }) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new ValidationError(`Invalid table name ${name}`)
    }
    this.name = name
    this.columns = columns.map(column => column instanceof Column ? column : new Column(column))
    this.primaryKey = primaryKey
    this.unique = unique
    const names = new Set(this.columns.map(column => column.name))
    if (names.size !== this.columns.length) {
      throw new ValidationError("Duplicate column")
    }
    for (const column of [...primaryKey, ...unique.flat()]) {
      if (!names.has(column)) {
        throw new ValidationError(`Unknown constrained column ${column}`)
      }
    }
  }

  indexOf(name) {
    const index = this.columns.findIndex(column => column.name === name)
    if (index < 0) {
      throw new ValidationError(`Unknown column ${name}`)
    }
    return index
  }

  normalize(input) {
    const row = new Array(this.columns.length)
    for (let index = 0; index < this.columns.length; index += 1) {
      const column = this.columns[index]
      row[index] = Object.hasOwn(input, column.name) ? input[column.name] : column.defaultValue
    }
    this.validateRow(row)
    return row
  }

  validateRow(row) {
    for (let index = 0; index < this.columns.length; index += 1) {
      this.validate(this.columns[index], row[index])
    }
  }

  validate(column, value) {
    if (value === null) {
      if (!column.nullable || this.primaryKey.includes(column.name)) {
        throw new ConstraintError(`${column.name} cannot be null`)
      }
      return
    }
    if (column.type === DataType.BOOLEAN && typeof value !== "boolean") {
      throw new ConstraintError(`${column.name} must be boolean`)
    }
    if (column.type === DataType.INT32 && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)) {
      throw new ConstraintError(`${column.name} must be int32`)
    }
    if ((column.type === DataType.INT64 || column.type === DataType.TIMESTAMP) && typeof value !== "bigint") {
      throw new ConstraintError(`${column.name} must be bigint`)
    }
    if (column.type === DataType.FLOAT64 && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new ConstraintError(`${column.name} must be finite`)
    }
    if (column.type === DataType.TEXT && typeof value !== "string") {
      throw new ConstraintError(`${column.name} must be text`)
    }
  }
}
