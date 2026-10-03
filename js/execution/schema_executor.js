import { Column, TableSchema } from "../catalog/schema.js"

export class SchemaExecutor {
  constructor(catalog, tables, queryCache) {
    this.catalog = catalog
    this.tables = tables
    this.queryCache = queryCache
  }

  createTable(statement, transaction) {
    this.queryCache.clear()
    const columns = statement.columns.map(column => new Column({ name: column.name, type: column.dataType, nullable: column.nullable, references: column.references }))
    const schema = new TableSchema({ name: statement.name, columns, primaryKey: statement.primaryKey, unique: statement.unique })
    const table = this.catalog.createTable(schema)
    for (const uniqueColumns of schema.unique) {
      table.indexes[table.indexes.length] = { name: `${schema.name}_${uniqueColumns.join("_")}_key`, columns: uniqueColumns, unique: true }
    }
    transaction.addUndo(() => {
      this.catalog.dropTable(schema.name)
      this.tables.clear(schema.name)
    })
    return { status: "CREATE TABLE", table: table.schema.name }
  }

  dropTable(statement, transaction) {
    this.queryCache.clear()
    const metadata = this.catalog.getTable(statement.name)
    this.catalog.dropTable(statement.name)
    this.tables.clear(statement.name)
    transaction.addUndo(() => this.catalog.tables.set(statement.name, metadata))
    return { status: "DROP TABLE" }
  }

  createIndex(statement, transaction) {
    this.queryCache.clear()
    this.catalog.addIndex(statement.table, statement)
    this.tables.clear(statement.table)
    transaction.addUndo(() => {
      this.catalog.dropIndex(statement.name)
      this.tables.clear(statement.table)
    })
    return { status: "CREATE INDEX" }
  }

  dropIndex(statement, transaction) {
    this.queryCache.clear()
    let owner
    for (const table of this.catalog.tables.values()) {
      const definition = table.indexes.find(index => index.name === statement.name)
      if (definition) {
        owner = { table, definition }
        break
      }
    }
    this.catalog.dropIndex(statement.name)
    this.tables.clear(owner.table.schema.name)
    transaction.addUndo(() => {
      owner.table.indexes[owner.table.indexes.length] = owner.definition
    })
    return { status: "DROP INDEX" }
  }
}
