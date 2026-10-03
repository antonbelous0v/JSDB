import { Database } from "./database.js"
import { runShell } from "./cli/shell.js"
import { formatRows } from "./cli/format.js"
import { inspectPage } from "./cli/inspect_page.js"
import { inspectWal } from "./cli/inspect_wal.js"
import { runDatabaseServer } from "./server/database_server.js"

const argumentsList = Host.process.argv.slice(1)
const command = argumentsList[0]

if (command === "inspect-page") {
  print(formatRows(inspectPage(Host, argumentsList[1], Number(argumentsList[2]))))
} else if (command === "inspect-wal") {
  print(formatRows(inspectWal(Host, argumentsList[1])))
} else {
  const path = argumentsList.find(argument => !argument.startsWith("--"))

  if (!path) {
    throw new Error("Usage: mydb database.db [--shell]")
  }

  const database = Database.open(path)

  try {
    const serverIndex = argumentsList.indexOf("--server")
    if (serverIndex >= 0) {
      runDatabaseServer(database, argumentsList[serverIndex + 1])
    } else if (argumentsList.includes("--shell")) {
      runShell(database)
    }
  } finally {
    database.close()
  }
}
