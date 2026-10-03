import { decodeTextMessage, encodeMessage, MessageDecoder, MessageType, PROTOCOL_VERSION } from "../protocol/message.js"
import { errorMessage, resultMessages, rowMessages } from "../protocol/result.js"
import { Binder } from "../sql/binder.js"
import { Parser } from "../sql/parser.js"

function writeMessages(socket, messages, host) {
  for (const message of messages) {
    host.net.write(socket, message)
  }
}

function selectColumns(database, sql) {
  const statements = new Parser(sql).parse()
  if (statements.length !== 1 || statements[0].type !== "select") {
    return null
  }
  const bound = new Binder(database.catalog).bind(statements[0])
  const descriptions = []
  for (const item of bound.columns) {
    const expression = item.expression
    if (expression.type === "star") {
      for (const reference of bound.references) {
        for (const column of reference.schema.columns) {
          descriptions[descriptions.length] = { name: column.name, type: column.type, table: reference.schema.name, nullable: column.nullable }
        }
      }
      continue
    }
    const reference = expression.binding ? bound.references.find(value => value.alias === expression.binding.table) : null
    const column = reference ? reference.schema.columns[expression.binding.index] : null
    descriptions[descriptions.length] = {
      name: item.alias ?? expression.name ?? `column_${descriptions.length + 1}`,
      type: column?.type ?? "UNKNOWN",
      table: reference?.schema.name ?? "",
      nullable: column?.nullable ?? true,
    }
  }
  return descriptions
}

function ready(socket, session, host) {
  host.net.write(socket, encodeMessage(MessageType.READY_FOR_QUERY, new Uint8Array([session.current ? 84 : 73])))
}

function metadata(database) {
  const rows = []
  for (const table of database.catalog.tables.values()) {
    for (const column of table.schema.columns) {
      rows[rows.length] = [table.schema.name, column.name, column.type, column.nullable, table.schema.primaryKey.includes(column.name)]
    }
  }
  return rowMessages(rows, [
    { name: "table", type: "TEXT", nullable: false },
    { name: "column", type: "TEXT", nullable: false },
    { name: "type", type: "TEXT", nullable: false },
    { name: "nullable", type: "BOOLEAN", nullable: false },
    { name: "primary", type: "BOOLEAN", nullable: false },
  ])
}

function validateSessionSql(sql, session) {
  const statements = new Parser(sql).parse()
  const hasDdl = statements.some(statement => statement.type === "create_table" || statement.type === "drop_table" || statement.type === "create_index" || statement.type === "drop_index")
  const hasTransactionControl = statements.some(statement => statement.type === "begin" || statement.type === "commit" || statement.type === "rollback")
  if (hasDdl && (session.current || hasTransactionControl)) {
    throw new Error("DDL inside an explicit server transaction is not supported")
  }
}

function handleMessage(connection, message, database, host) {
  const { socket, session } = connection
  if (message.type === MessageType.STARTUP) {
    if (connection.started) {
      host.net.write(socket, errorMessage(new Error("Startup message already received")))
      ready(socket, session, host)
      return true
    }
    const version = message.payload.length === 4 ? new DataView(message.payload.buffer, message.payload.byteOffset, 4).getUint32(0, false) : 0
    if (version !== PROTOCOL_VERSION) {
      host.net.write(socket, errorMessage(new Error(`Unsupported protocol version ${version}`)))
      return false
    }
    connection.started = true
    host.net.write(socket, encodeMessage(MessageType.AUTHENTICATION_OK))
    ready(socket, session, host)
    return true
  }
  if (!connection.started) {
    host.net.write(socket, errorMessage(new Error("Startup message required")))
    return false
  }
  if (message.type === MessageType.METADATA) {
    writeMessages(socket, metadata(database), host)
    ready(socket, session, host)
    return true
  }
  if (message.type !== MessageType.QUERY) {
    host.net.write(socket, errorMessage(new Error("Unsupported protocol message")))
    ready(socket, session, host)
    return true
  }
  try {
    const sql = decodeTextMessage(message)
    validateSessionSql(sql, session)
    writeMessages(socket, resultMessages(database.execute(sql, session), selectColumns(database, sql)), host)
  } catch (error) {
    host.net.write(socket, errorMessage(error))
  }
  ready(socket, session, host)
  return true
}

function closeConnection(connection, host) {
  if (connection.session.current) {
    connection.session.rollback()
  }
  host.net.close(connection.socket)
}

export function runDatabaseServer(database, address, host = Host) {
  const separator = address.lastIndexOf(":")
  const hostname = address.slice(0, separator)
  const port = Number(address.slice(separator + 1))
  if (!hostname || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Server address must be HOST:PORT")
  }
  if (hostname !== "127.0.0.1") {
    throw new Error("Server must bind to 127.0.0.1; use SSH port forwarding for remote access")
  }
  const listener = host.net.listen(hostname, port)
  const connections = new Map()
  print(`mydb listening on ${hostname}:${port}`)
  try {
    while (true) {
      const sockets = [listener, ...connections.keys()]
      for (const socket of host.net.poll(sockets, 1000)) {
        if (socket === listener) {
          const client = host.net.accept(listener)
          host.net.setNonblocking(client)
          const session = database.createSession()
          connections.set(client, { socket: client, session, decoder: new MessageDecoder(), started: false })
          continue
        }
        try {
          const connection = connections.get(socket)
          const chunk = host.net.read(socket, 65536)
          if (chunk === null) {
            continue
          }
          if (!chunk.length) {
            closeConnection(connection, host)
            connections.delete(socket)
            continue
          }
          let keep = true
          for (const message of connection.decoder.write(chunk)) {
            if (!handleMessage(connection, message, database, host)) {
              keep = false
              break
            }
          }
          if (!keep) {
            closeConnection(connection, host)
            connections.delete(socket)
          }
        } catch {
          const connection = connections.get(socket)
          if (connection) {
            closeConnection(connection, host)
            connections.delete(socket)
          }
        }
      }
    }
  } finally {
    for (const connection of connections.values()) {
      closeConnection(connection, host)
    }
    host.net.close(listener)
  }
}
