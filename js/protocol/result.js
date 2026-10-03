import { encodeUtf8 } from "../binary/utf8.js"
import { MessageType, encodeMessage, encodeTextMessage } from "./message.js"

function appendU32(parts, value) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value, false)
  parts[parts.length] = bytes
}

function appendText(parts, value) {
  const bytes = encodeUtf8(value ?? "")
  appendU32(parts, bytes.length)
  parts[parts.length] = bytes
}

function join(parts) {
  let length = 0
  for (const part of parts) {
    length += part.length
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

function encodeFields(values) {
  const parts = [new Uint8Array(2)]
  new DataView(parts[0].buffer).setUint16(0, values.length, false)
  for (const value of values) {
    if (value === null || value === undefined) {
      parts[parts.length] = new Uint8Array([0])
      appendU32(parts, 0)
      continue
    }
    let type = 4
    let bytes
    if (typeof value === "bigint") {
      type = 1
      bytes = encodeUtf8(value.toString())
    } else if (typeof value === "number") {
      type = 2
      bytes = new Uint8Array(8)
      new DataView(bytes.buffer).setFloat64(0, value, false)
    } else if (typeof value === "boolean") {
      type = 3
      bytes = new Uint8Array([value ? 1 : 0])
    } else {
      bytes = encodeUtf8(String(value))
    }
    parts[parts.length] = new Uint8Array([type])
    appendU32(parts, bytes.length)
    parts[parts.length] = bytes
  }
  return join(parts)
}

function encodeDescription(columns) {
  const parts = [new Uint8Array(2)]
  new DataView(parts[0].buffer).setUint16(0, columns.length, false)
  for (const column of columns) {
    const descriptor = typeof column === "string" ? { name: column } : column
    appendText(parts, descriptor.name)
    appendText(parts, descriptor.type ?? "UNKNOWN")
    appendText(parts, descriptor.table ?? "")
    parts[parts.length] = new Uint8Array([descriptor.nullable === false ? 0 : 1])
  }
  return join(parts)
}

export function rowMessages(rows, columns = null) {
  const messages = []
  const width = rows.length ? rows[0].length : columns?.length ?? 0
  const descriptions = columns ?? []
  if (!columns) {
    for (let index = 0; index < width; index += 1) {
      descriptions[index] = { name: `column_${index + 1}` }
    }
  }
  messages[messages.length] = encodeMessage(MessageType.ROW_DESCRIPTION, encodeDescription(descriptions))
  for (const row of rows) {
    messages[messages.length] = encodeMessage(MessageType.DATA_ROW, encodeFields(row))
  }
  messages[messages.length] = encodeTextMessage(MessageType.COMMAND_COMPLETE, `SELECT ${rows.length}`)
  return messages
}

export function resultMessages(result, columns = null) {
  const messages = []
  if (Array.isArray(result) && (result.length === 0 || Array.isArray(result[0]))) {
    return rowMessages(result, columns)
  }
  if (Array.isArray(result)) {
    for (const item of result) {
      const nested = resultMessages(item)
      for (const message of nested) {
        messages[messages.length] = message
      }
    }
    return messages
  }
  const suffix = result.rows === undefined ? "" : ` ${result.rows}`
  messages[0] = encodeTextMessage(MessageType.COMMAND_COMPLETE, `${result.status}${suffix}`)
  return messages
}

export function errorMessage(error) {
  return encodeMessage(MessageType.ERROR_RESPONSE, encodeFields([error.code ?? error.name, error.message]))
}
