import { Table } from "./catalog/table.js"

export class TableRegistry {
  constructor(catalog, bufferPool, transactions) {
    this.catalog = catalog
    this.bufferPool = bufferPool
    this.transactions = transactions
    this.tables = new Map()
  }

  table(name) {
    let table = this.tables.get(name)
    if (!table) {
      table = new Table(this.catalog.getTable(name), this.bufferPool, this.transactions, this)
      this.tables.set(name, table)
    }
    return table
  }

  clear(name) {
    if (name) {
      this.tables.delete(name)
      return
    }
    this.tables.clear()
  }

  assertDeleteAllowed(tableName, row, transaction) {
    const referenced = this.catalog.getTable(tableName)
    for (const metadata of this.catalog.tables.values()) {
      for (let index = 0; index < metadata.schema.columns.length; index += 1) {
        const column = metadata.schema.columns[index]
        if (!column.references || column.references.table !== tableName) {
          continue
        }
        const targetIndex = referenced.schema.indexOf(column.references.column)
        for (const candidate of this.table(metadata.schema.name).scan(transaction)) {
          if (candidate.row[index] === row[targetIndex]) {
            throw new Error(`Delete restricted by ${metadata.schema.name}.${column.name}`)
          }
        }
      }
    }
  }
}
