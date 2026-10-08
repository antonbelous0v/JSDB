import { TransactionState } from "../constants.js"
import { ValidationError } from "../errors.js"

export class TransactionSession {
  constructor(transactions, commitCoordinator, queryCache, tables) {
    this.transactions = transactions
    this.commitCoordinator = commitCoordinator
    this.queryCache = queryCache
    this.tables = tables
    this.current = null
  }

  execute(statement, action) {
    if (statement.type === "begin") {
      return this.begin(statement.readOnly)
    }
    if (statement.type === "commit") {
      return this.commit()
    }
    if (statement.type === "rollback") {
      return this.rollback()
    }
    const readOnly = statement.type === "select" || statement.type === "explain"
    if (this.current?.readOnly && !readOnly) {
      throw new ValidationError("Write statement is not allowed in a read-only transaction")
    }
    const owned = !this.current
    const transaction = this.current ?? this.transactions.begin(readOnly)
    try {
      const result = action(transaction)
      if (owned) {
        this.commitCoordinator.commit(transaction)
      }
      return result
    } catch (error) {
      if (owned && transaction.state === TransactionState.ACTIVE) {
        this.transactions.rollback(transaction)
        this.invalidate()
      }
      throw error
    }
  }

  begin(readOnly = false) {
    if (this.current) {
      throw new Error("Transaction already active")
    }
    this.current = this.transactions.begin(readOnly)
    return { status: "BEGIN" }
  }

  commit() {
    if (!this.current) {
      throw new Error("No active transaction")
    }
    this.commitCoordinator.commit(this.current)
    this.current = null
    return { status: "COMMIT" }
  }

  rollback() {
    if (!this.current) {
      throw new Error("No active transaction")
    }
    this.transactions.rollback(this.current)
    this.current = null
    this.invalidate()
    return { status: "ROLLBACK" }
  }

  invalidate() {
    this.queryCache.clear()
    this.tables.clear()
  }
}
