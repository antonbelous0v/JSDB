import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"

import { Database } from "../js/database.js"
import { createHost } from "../tests/host.js"

const count = Number(process.argv[2] ?? 2000)
const commitCount = Math.min(100, Math.max(20, Math.floor(count / 20)))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mydb-suite-"))
const file = path.join(directory, "data.db")
const host = createHost()
let database = Database.open(file, host)
const results = []

measure("create schema", 1, () => database.execute("CREATE TABLE records (id BIGINT PRIMARY KEY, category INT NOT NULL, value BIGINT NOT NULL, label TEXT NOT NULL)"))

measure("bulk insert", count, () => {
  database.execute("BEGIN")
  for (let index = 0; index < count; index += 1) {
    database.execute(`INSERT INTO records VALUES (${index}, ${index % 20}, ${index * 3}, 'record-${index}')`)
  }
  database.execute("COMMIT")
})

measure("indexed point read", count, () => {
  for (let index = 0; index < count; index += 1) {
    database.execute(`SELECT value FROM records WHERE id = ${index}`)
  }
})

measure("indexed reads in tx", count, () => {
  database.execute("BEGIN")
  for (let index = 0; index < count; index += 1) {
    database.execute(`SELECT value FROM records WHERE id = ${index}`)
  }
  database.execute("COMMIT")
})

const preparedRead = database.prepare("SELECT value FROM records WHERE id = ?")
measure("prepared point read", count, () => {
  for (let index = 0; index < count; index += 1) {
    preparedRead.execute([BigInt(index)])
  }
})

measure("sequential predicate", 100, () => {
  for (let index = 0; index < 100; index += 1) {
    database.execute(`SELECT id FROM records WHERE category = ${index % 20}`)
  }
})

measure("bounded range", 100, () => {
  for (let index = 0; index < 100; index += 1) {
    database.execute(`SELECT id FROM records WHERE id >= ${index} AND id < ${index + 100} LIMIT 25`)
  }
})

measure("aggregate scan", 100, () => {
  for (let index = 0; index < 100; index += 1) {
    database.execute("SELECT COUNT(*), SUM(value), MIN(value), MAX(value), AVG(value) FROM records")
  }
})

measure("transactional update", 100, () => {
  database.execute("BEGIN")
  for (let index = 0; index < 100; index += 1) {
    database.execute(`UPDATE records SET value = value + 1 WHERE id = ${index}`)
  }
  database.execute("COMMIT")
})

const commits = []
for (let index = 0; index < commitCount; index += 1) {
  const start = performance.now()
  database.execute(`INSERT INTO records VALUES (${count + index}, ${index % 20}, ${index}, 'commit-${index}')`)
  commits.push(performance.now() - start)
}
results.push({ name: "autocommit latency", operations: commitCount, milliseconds: commits.reduce((sum, value) => sum + value, 0), rate: commitCount / (commits.reduce((sum, value) => sum + value, 0) / 1000), p50: percentile(commits, 0.5), p95: percentile(commits, 0.95), p99: percentile(commits, 0.99) })

measure("checkpoint", 1, () => database.checkpoint())
database.close()

measure("reopen", 1, () => {
  database = Database.open(file, host)
})
measure("cold indexed read", 1, () => database.execute(`SELECT value FROM records WHERE id = ${count - 1}`))
database.close()

for (const result of results) {
  const tail = result.p50 === undefined ? "" : ` p50=${result.p50.toFixed(3)}ms p95=${result.p95.toFixed(3)}ms p99=${result.p99.toFixed(3)}ms`
  console.log(`${result.name.padEnd(22)} ${result.operations.toString().padStart(6)} ops ${result.milliseconds.toFixed(3).padStart(10)} ms ${Math.round(result.rate).toString().padStart(10)} ops/s${tail}`)
}

fs.rmSync(directory, { recursive: true })

function measure(name, operations, action) {
  const start = performance.now()
  action()
  const milliseconds = performance.now() - start
  results.push({ name, operations, milliseconds, rate: operations / (milliseconds / 1000) })
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * fraction) - 1)]
}
