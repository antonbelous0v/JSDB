import { TransactionState } from "../constants.js"

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
      return this.begin()
    }
    if (statement.type === "commit") {
      return this.commit()
    }
    if (statement.type === "rollback") {
      return this.rollback()
    }
    const owned = !this.current
    const transaction = this.current ?? this.transactions.begin(statement.type === "select" || statement.type === "explain")
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

  begin() {
    if (this.current) {
      throw new Error("Transaction already active")
    }
    this.current = this.transactions.begin()
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
