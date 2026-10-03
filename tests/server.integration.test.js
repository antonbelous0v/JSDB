import assert from "node:assert/strict"
import { once } from "node:events"
import fs from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { spawn, spawnSync } from "node:child_process"
import test from "node:test"

import { DatabaseConnection } from "../ui/database_connection.js"
import { decodeResult } from "../ui/result.js"

const executable = path.resolve("build", process.platform === "win32" ? "mydb.exe" : "mydb")

async function availablePort() {
  const server = net.createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const port = server.address().port
  server.close()
  await once(server, "close")
  return port
}

async function connectWhenReady(connection) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await connection.connect()
      return
    } catch {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  throw new Error("Database server did not start")
}

async function query(connection, sql) {
  return decodeResult(new Uint8Array(await connection.query(sql)))
}

test("server owns the database and isolates concurrent client sessions", { skip: !fs.existsSync(executable) }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mydb-server-"))
  const databasePath = path.join(directory, "data.db")
  const port = await availablePort()
  const server = spawn(executable, [databasePath, "--server", `127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] })
  const first = new DatabaseConnection("127.0.0.1", port)
  const second = new DatabaseConnection("127.0.0.1", port)
  try {
    await connectWhenReady(first)
    await second.connect()
    assert.equal((await query(first, "CREATE TABLE accounts (id BIGINT PRIMARY KEY, balance BIGINT NOT NULL);")).error, null)
    assert.equal((await query(first, "BEGIN;")).error, null)
    assert.equal((await query(first, "INSERT INTO accounts VALUES (1, 1000);")).error, null)
    assert.deepEqual((await query(second, "SELECT * FROM accounts;")).rows, [])
    assert.equal((await query(first, "COMMIT;")).error, null)
    const selected = await query(second, "SELECT * FROM accounts;")
    assert.deepEqual(selected.rows, [["1", "1000"]])
    assert.deepEqual(selected.fields, [
      { name: "id", type: "INT64", table: "accounts", nullable: false },
      { name: "balance", type: "INT64", table: "accounts", nullable: false },
    ])
    assert.equal((await query(first, "BEGIN;")).error, null)
    assert.match((await query(first, "CREATE TABLE hidden (id BIGINT PRIMARY KEY);")).error, /DDL inside an explicit server transaction/)
    assert.match((await query(second, "SELECT * FROM hidden;")).error, /does not exist/)
    assert.equal((await query(first, "ROLLBACK;")).error, null)
    const competing = spawnSync(executable, [databasePath, "--shell"], { encoding: "utf8" })
    assert.notEqual(competing.status, 0)
    assert.match(competing.stderr, /already open by another process/)
  } finally {
    first.close()
    second.close()
    server.kill("SIGTERM")
    await once(server, "exit")
  }
  const reopened = spawnSync(executable, [databasePath, "--shell"], { encoding: "utf8", input: ".quit\n" })
  assert.equal(reopened.status, 0, reopened.stderr)
})
