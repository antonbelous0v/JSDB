import { TransactionState, WalType } from "../constants.js"
import { WriteConflictError } from "../errors.js"

export class Transaction {
  constructor(id, snapshot, startLSN, readOnly) {
    this.id = id
    this.snapshot = snapshot
    this.startLSN = startLSN
    this.readOnly = readOnly
    this.state = TransactionState.ACTIVE
    this.undo = []
  }

  addUndo(action) {
    this.undo[this.undo.length] = action
  }
}

export class TransactionManager {
  constructor(wal, locks) {
    this.wal = wal
    this.locks = locks
    this.nextId = 1n
    this.transactions = new Map()
    this.states = new Map()
    this.committed = 0
    this.aborted = 0
    this.writer = null
  }

  begin(readOnly = false) {
    if (!readOnly && this.writer) {
      throw new WriteConflictError("Another write transaction is active")
    }
    const id = this.nextId++
    const active = new Set()
    let xmin = id
    for (const transaction of this.transactions.values()) {
      if (transaction.state !== TransactionState.ACTIVE) {
        continue
      }
      active.add(transaction.id)
      if (transaction.id < xmin) {
        xmin = transaction.id
      }
    }
    const snapshot = { xmin, xmax: this.nextId, active }
    const startLSN = readOnly ? 0n : this.wal.append(id, WalType.BEGIN, 0xffffffff, new Uint8Array())
    const transaction = new Transaction(id, snapshot, startLSN, readOnly)
    this.transactions.set(id, transaction)
    this.states.set(id, TransactionState.ACTIVE)
    if (!readOnly) {
      this.writer = transaction
    }
    return transaction
  }

  commit(transaction) {
    this.requireActive(transaction)
    if (!transaction.readOnly) {
      const lsn = this.wal.append(transaction.id, WalType.COMMIT, 0xffffffff, new Uint8Array())
      this.wal.sync(lsn)
    }
    transaction.state = TransactionState.COMMITTED
    this.states.set(transaction.id, transaction.state)
    this.transactions.delete(transaction.id)
    if (this.writer === transaction) {
      this.writer = null
    }
    if (transaction.readOnly) {
      this.states.delete(transaction.id)
    }
    this.locks.release(transaction.id)
    transaction.undo.length = 0
    this.committed += 1
  }

  rollback(transaction) {
    this.requireActive(transaction)
    for (let index = transaction.undo.length - 1; index >= 0; index -= 1) {
      transaction.undo[index]()
    }
    const lsn = this.wal.append(transaction.id, WalType.ABORT, 0xffffffff, new Uint8Array())
    this.wal.sync(lsn)
    transaction.state = TransactionState.ABORTED
    this.states.set(transaction.id, transaction.state)
    this.transactions.delete(transaction.id)
    if (this.writer === transaction) {
      this.writer = null
    }
    this.locks.release(transaction.id)
    this.aborted += 1
  }

  requireActive(transaction) {
    if (!transaction || transaction.state !== TransactionState.ACTIVE) {
      throw new Error("Transaction is not active")
    }
  }

  restore(records) {
    let maximum = 0n
    for (const record of records) {
      if (record.transactionId > maximum) {
        maximum = record.transactionId
      }
      if (record.type === WalType.BEGIN) {
        this.states.set(record.transactionId, TransactionState.ACTIVE)
      } else if (record.type === WalType.COMMIT) {
        this.states.set(record.transactionId, TransactionState.COMMITTED)
      } else if (record.type === WalType.ABORT) {
        this.states.set(record.transactionId, TransactionState.ABORTED)
      }
    }
    this.nextId = maximum + 1n
  }
}
