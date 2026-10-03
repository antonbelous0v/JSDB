import { ConstraintError } from "../errors.js"

export class TableConstraints {
  constructor(schema, indexes, tables) {
    this.schema = schema
    this.indexes = indexes
    this.tables = tables
  }

  validateInsert(row, transaction) {
    this.indexes.assertUnique(row)
    for (let index = 0; index < this.schema.columns.length; index += 1) {
      const column = this.schema.columns[index]
      if (!column.references || row[index] === null) {
        continue
      }
      const referenced = this.tables.table(column.references.table)
      const definition = [...referenced.indexes.values()].find(candidate => candidate.definition.unique && candidate.definition.columns.length === 1 && candidate.definition.columns[0] === column.references.column)
      if (!definition || !referenced.lookup(definition.definition.name, row[index], transaction).length) {
        throw new ConstraintError(`Foreign key ${column.name} failed`)
      }
    }
  }

  validateDelete(row, transaction) {
    this.tables.assertDeleteAllowed(this.schema.name, row, transaction)
  }
}
