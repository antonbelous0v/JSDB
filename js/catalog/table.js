import { Heap } from "../storage/heap.js"
import { TupleCodec } from "../storage/tuple_codec.js"
import { TransactionState, WalType } from "../constants.js"
import { isVisible } from "../transaction/snapshot.js"
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
    const row = this.schema.normalize(input)
    return this.insertValidatedRow(row, transaction)
  }

  insertRow(row, transaction) {
    this.schema.validateRow(row)
    return this.insertValidatedRow(row, transaction)
  }

  insertValidatedRow(row, transaction) {
    this.transactions.requireActive(transaction)
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

  deleteWhere(predicate, transaction, candidates = null) {
    let count = 0
    const rows = candidates ?? this.scan(transaction)
    for (const item of rows) {
      if (predicate(item.row)) {
        this.deleteOne(item, transaction)
        count += 1
      }
    }
    return count
  }

  updateWhere(predicate, update, transaction, candidates = null) {
    let count = 0
    const rows = candidates ?? this.scan(transaction)
    for (const item of rows) {
      if (!predicate(item.row)) {
        continue
      }
      const row = item.row.slice()
      update(row)
      this.schema.validateRow(row)
      this.deleteOne(item, transaction)
      this.insertValidatedRow(row, transaction)
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

  forEachRow(transaction, action) {
    return this.versions.forEachRow(transaction, action)
  }

  lookup(indexName, key, transaction) {
    return this.indexManager.lookup(indexName, key, transaction, this.versions)
  }

  vacuum(transaction) {
    this.transactions.requireActive(transaction)
    const pages = new Map()
    this.versions.forEachVersion((rid, version) => {
      const insertedAborted = this.transactions.states.get(version.xmin) === TransactionState.ABORTED
      const deletedCommitted = version.xmax !== 0n && this.transactions.states.get(version.xmax) === TransactionState.COMMITTED
      if (!insertedAborted && !deletedCommitted) {
        return
      }
      for (const active of this.transactions.transactions.values()) {
        if (active !== transaction && isVisible(version, active.snapshot, active.id, this.transactions.states)) {
          return
        }
      }
      let entries = pages.get(rid.pageId)
      if (!entries) {
        entries = []
        pages.set(rid.pageId, entries)
      }
      entries[entries.length] = { rid, version }
    })
    let count = 0
    for (const [pageId, entries] of pages) {
      const slots = new Array(entries.length)
      for (let index = 0; index < entries.length; index += 1) {
        slots[index] = entries[index].rid.slotId
      }
      const before = this.heap.vacuumPage(pageId, slots)
      for (let index = 0; index < entries.length; index += 1) {
        this.versions.remove(entries[index].rid)
      }
      transaction.addUndo(() => {
        this.heap.restorePage(pageId, before)
        for (let index = 0; index < entries.length; index += 1) {
          this.versions.set(entries[index].rid, entries[index].version)
        }
      })
      count += entries.length
    }
    return count
  }

  setPageLSN(pageId, lsn) {
    const page = this.heap.bufferPool.get(pageId)
    page.pageLSN = lsn
    this.heap.bufferPool.unpin(page, true)
  }
}
