import assert from "node:assert/strict"
import test from "node:test"

import { TransactionState } from "../js/constants.js"
import { WriteConflictError } from "../js/errors.js"
import { LockTable } from "../js/transaction/lock_table.js"
import { isVisible } from "../js/transaction/snapshot.js"
import { TransactionManager } from "../js/transaction/transaction.js"

test("first writer keeps the row lock", () => {
  const locks = new LockTable()
  locks.acquire(1n, "users:1")
  assert.throws(() => locks.acquire(2n, "users:1"), WriteConflictError)
  locks.release(1n)
  locks.acquire(2n, "users:1")
})

test("snapshot visibility excludes active and future versions", () => {
  const states = new Map([[1n, TransactionState.COMMITTED], [2n, TransactionState.ACTIVE], [3n, TransactionState.COMMITTED]])
  const snapshot = { xmin: 2n, xmax: 3n, active: new Set([2n]) }
  assert.equal(isVisible({ xmin: 1n, xmax: 0n }, snapshot, 2n, states), true)
  assert.equal(isVisible({ xmin: 2n, xmax: 0n }, snapshot, 9n, states), false)
  assert.equal(isVisible({ xmin: 3n, xmax: 0n }, snapshot, 2n, states), false)
})

test("transaction manager allows readers beside one writer", () => {
  const wal = { append: () => 1n, sync: () => {} }
  const transactions = new TransactionManager(wal, new LockTable())
  const writer = transactions.begin()
  const reader = transactions.begin(true)
  assert.throws(() => transactions.begin(), WriteConflictError)
  transactions.commit(reader)
  transactions.commit(writer)
  const next = transactions.begin()
  transactions.rollback(next)
})
