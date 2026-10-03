import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { DatabaseConnection } from "./database_connection.js"
import { openSshTunnel } from "./ssh_tunnel.js"

const root = path.dirname(fileURLToPath(import.meta.url))
const argumentsList = process.argv.slice(2)

function option(name, fallback) {
  const index = argumentsList.indexOf(name)
  return index < 0 ? fallback : argumentsList[index + 1]
}

const uiPort = Number(option("--port", "8080"))
const remotePort = Number(option("--remote-port", option("--db-port", "7432")))
const sshTarget = option("--ssh", null)
const databasePort = sshTarget ? Number(option("--forward-port", "7433")) : remotePort
const tunnel = openSshTunnel(sshTarget, databasePort, remotePort)
const database = new DatabaseConnection(option("--db-host", "127.0.0.1"), databasePort)
const MAX_QUERY_BYTES = 16 * 1024 * 1024
const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/database_client.js", ["database_client.js", "text/javascript; charset=utf-8"]],
  ["/query_controller.js", ["query_controller.js", "text/javascript; charset=utf-8"]],
  ["/result.js", ["result.js", "text/javascript; charset=utf-8"]],
  ["/view.js", ["view.js", "text/javascript; charset=utf-8"]],
  ["/sql_builder.js", ["sql_builder.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
])

async function binaryResponse(response, action) {
  try {
    const result = await action()
    response.writeHead(200, { "content-type": "application/octet-stream" })
    response.end(result)
  } catch (error) {
    response.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
    response.end(error.message)
  }
}

const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/query") {
    let sql = ""
    let size = 0
    request.setEncoding("utf8")
    for await (const chunk of request) {
      size += Buffer.byteLength(chunk)
      if (size > MAX_QUERY_BYTES) {
        response.writeHead(413, { "content-type": "text/plain; charset=utf-8" })
        response.end("Query exceeds 16 MiB")
        return
      }
      sql += chunk
    }
    await binaryResponse(response, () => database.query(sql))
    return
  }
  if (request.method === "GET" && request.url === "/metadata") {
    await binaryResponse(response, () => database.metadata())
    return
  }
  const asset = assets.get(request.url)
  if (!asset) {
    response.writeHead(404)
    response.end("Not found")
    return
  }
  response.writeHead(200, { "content-type": asset[1] })
  response.end(fs.readFileSync(path.join(root, asset[0])))
})

server.listen(uiPort, "127.0.0.1", () => {
  process.stdout.write(`MyDB UI: http://127.0.0.1:${uiPort}\n`)
})

let stopping = false

function shutdown() {
  if (stopping) {
    return
  }
  stopping = true
  database.close()
  tunnel?.kill()
  server.close(() => process.exit(0))
  server.closeAllConnections()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
