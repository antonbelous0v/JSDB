import { ConstraintError } from "../errors.js"
import { CatalogStore } from "./catalog_store.js"

export class Catalog {
  constructor(store, tables = []) {
    this.store = store
    this.bufferPool = store.bufferPool
    this.tables = new Map(tables.map(table => [table.schema.name, table]))
    this.nextId = tables.reduce((maximum, table) => table.id > maximum ? table.id : maximum, 0n) + 1n
    this.dirty = false
    this.revision = 0
  }

  static load(bufferPool, rootPageId) {
    const loaded = CatalogStore.load(bufferPool, rootPageId)
    return new Catalog(loaded.store, loaded.tables)
  }

  get pageIds() {
    return this.store.pageIds
  }

  createTable(schema) {
    if (this.tables.has(schema.name)) {
      throw new ConstraintError(`Table ${schema.name} already exists`)
    }
    const table = { id: this.nextId++, schema, pageIds: [], indexes: [] }
    this.tables.set(schema.name, table)
    this.dirty = true
    this.revision += 1
    return table
  }

  dropTable(name) {
    if (!this.tables.delete(name)) {
      throw new ConstraintError(`Table ${name} does not exist`)
    }
    this.dirty = true
    this.revision += 1
  }

  getTable(name) {
    const table = this.tables.get(name)
    if (!table) {
      throw new ConstraintError(`Table ${name} does not exist`)
    }
    return table
  }

  addIndex(tableName, definition) {
    const table = this.getTable(tableName)
    for (const candidate of this.tables.values()) {
      if (candidate.indexes.some(index => index.name === definition.name)) {
        throw new ConstraintError(`Index ${definition.name} already exists`)
      }
    }
    for (const column of definition.columns) {
      table.schema.indexOf(column)
    }
    table.indexes[table.indexes.length] = { name: definition.name, columns: [...definition.columns], unique: Boolean(definition.unique) }
    this.dirty = true
    this.revision += 1
  }

  dropIndex(name) {
    for (const table of this.tables.values()) {
      const index = table.indexes.findIndex(candidate => candidate.name === name)
      if (index >= 0) {
        table.indexes.splice(index, 1)
        this.dirty = true
        this.revision += 1
        return
      }
    }
    throw new ConstraintError(`Index ${name} does not exist`)
  }

  persist() {
    if (!this.dirty && this.bufferPool.pager.header.catalogRoot) {
      return false
    }
    const newRoot = this.store.persist([...this.tables.values()])
    this.dirty = false
    return newRoot
  }

  markDirty() {
    this.dirty = true
  }
}
