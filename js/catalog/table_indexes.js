import { BTree } from "../index/btree.js"
import { ConstraintError } from "../errors.js"

export class TableIndexes {
  constructor(metadata) {
    this.schema = metadata.schema
    this.indexes = new Map()
    const definitions = [...metadata.indexes]
    const primaryName = `${this.schema.name}_pkey`
    if (this.schema.primaryKey.length && !definitions.some(definition => definition.name === primaryName)) {
      definitions.unshift({ name: primaryName, columns: this.schema.primaryKey, unique: true })
    }
    for (const definition of definitions) {
      this.indexes.set(definition.name, { definition, tree: new BTree(32, definition.unique) })
    }
  }

  lookup(name, key, transaction, versions) {
    const index = this.indexes.get(name)
    if (!index) {
      throw new ConstraintError(`Index ${name} does not exist`)
    }
    const found = index.tree.find(key)
    if (found === undefined) {
      return []
    }
    const rows = []
    if (index.definition.unique) {
      const version = versions.visible(found, transaction)
      if (version) {
        rows[0] = { rid: found, row: version.row }
      }
      return rows
    }
    for (const entry of index.tree.range(key, key)) {
      const version = versions.visible(entry.value, transaction)
      if (version) {
        rows[rows.length] = { rid: entry.value, row: version.row }
      }
    }
    return rows
  }

  assertUnique(row) {
    for (const { definition, tree } of this.indexes.values()) {
      if (definition.unique && tree.find(this.key(definition, row)) !== undefined) {
        throw new ConstraintError(`Unique constraint ${definition.name} failed`)
      }
    }
  }

  add(row, rid) {
    for (const { definition, tree } of this.indexes.values()) {
      tree.insert(this.key(definition, row), rid)
    }
  }

  remove(row, rid) {
    for (const { definition, tree } of this.indexes.values()) {
      tree.remove(this.key(definition, row), rid)
    }
  }

  key(definition, row) {
    const values = definition.columns.map(column => row[this.schema.indexOf(column)])
    return values.length === 1 ? values[0] : values
  }
}
