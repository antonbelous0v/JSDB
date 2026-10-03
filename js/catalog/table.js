import { Heap } from "../storage/heap.js"
import { TupleCodec } from "../storage/tuple_codec.js"
import { TransactionState, WalType } from "../constants.js"
import { RowVersions } from "./row_versions.js"
import { TableIndexes } from "./table_indexes.js"
import { TableConstraints } from "./table_constraints.js"

function ridKey(rid) {
  return `${rid.pageId}:${rid.slotId}`
}

export class Table {
  constructor(metadata, bufferPool, transactions, tables) {
    this.metadata = metadata
    this.schema = metadata.schema
    this.heap = new Heap(bufferPool, metadata.pageIds)
    this.transactions = transactions
    this.versions = new RowVersions(transactions.states)
    this.indexManager = new TableIndexes(metadata)
    this.indexes = this.indexManager.indexes
    this.constraints = new TableConstraints(this.schema, this.indexManager, tables)
    this.loadRows()
  }

  loadRows() {
    this.heap.forEach((pageId, slotId, bytes) => {
      const version = TupleCodec.decode(this.schema, bytes)
      const rid = { pageId, slotId }
      this.versions.set(rid, version)
      if (this.transactions.states.get(version.xmin) === TransactionState.COMMITTED && (version.xmax === 0n || this.transactions.states.get(version.xmax) !== TransactionState.COMMITTED)) {
        this.indexManager.add(version.row, rid)
      }
    })
  }

  insert(input, transaction) {
    this.transactions.requireActive(transaction)
    const row = this.schema.normalize(input)
    this.constraints.validateInsert(row, transaction)
    const bytes = TupleCodec.encode(this.schema, row, transaction.id)
    const rid = this.heap.insert(bytes)
    this.versions.set(rid, { xmin: transaction.id, xmax: 0n, row })
    this.indexManager.add(row, rid)
    const lsn = this.transactions.wal.append(transaction.id, WalType.INSERT, rid.pageId, bytes)
    this.setPageLSN(rid.pageId, lsn)
    transaction.addUndo(() => {
      this.indexManager.remove(row, rid)
      this.versions.remove(rid)
      this.heap.remove(rid)
    })
    return rid
  }

  deleteWhere(predicate, transaction) {
    let count = 0
    for (const item of this.scan(transaction)) {
      if (predicate(item.row)) {
        this.deleteOne(item, transaction)
        count += 1
      }
    }
    return count
  }

  updateWhere(predicate, changes, transaction) {
    let count = 0
    for (const item of this.scan(transaction)) {
      if (!predicate(item.row)) {
        continue
      }
      const input = Object.fromEntries(this.schema.columns.map((column, index) => [column.name, item.row[index]]))
      for (const [name, value] of Object.entries(changes)) {
        input[name] = typeof value === "function" ? value(input[name], input) : value
      }
      this.deleteOne(item, transaction)
      this.insert(input, transaction)
      count += 1
    }
    return count
  }

  deleteOne(item, transaction) {
    this.constraints.validateDelete(item.row, transaction)
    this.transactions.locks.acquire(transaction.id, `${this.schema.name}:${ridKey(item.rid)}`)
    const oldBytes = this.heap.get(item.rid)
    const version = this.versions.get(item.rid)
    const oldXmax = version.xmax
    const newBytes = TupleCodec.encode(this.schema, version.row, version.xmin, transaction.id)
    this.heap.update(item.rid, newBytes)
    version.xmax = transaction.id
    this.indexManager.remove(version.row, item.rid)
    const lsn = this.transactions.wal.append(transaction.id, WalType.DELETE, item.rid.pageId, newBytes)
    this.setPageLSN(item.rid.pageId, lsn)
    transaction.addUndo(() => {
      version.xmax = oldXmax
      this.heap.update(item.rid, oldBytes)
      this.indexManager.add(version.row, item.rid)
    })
  }

  scan(transaction) {
    const rows = []
    this.forEach(transaction, (item) => {
      rows[rows.length] = item
    })
    return rows
  }

  forEach(transaction, action) {
    return this.versions.forEach(transaction, action)
  }

  lookup(indexName, key, transaction) {
    return this.indexManager.lookup(indexName, key, transaction, this.versions)
  }

  setPageLSN(pageId, lsn) {
    const page = this.heap.bufferPool.get(pageId)
    page.pageLSN = lsn
    this.heap.bufferPool.unpin(page, true)
  }
}
