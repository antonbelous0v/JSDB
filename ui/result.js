const MESSAGE = { rowDescription: 84, dataRow: 68, command: 67, error: 69, ready: 90 }

function text(bytes) {
  return new TextDecoder().decode(bytes)
}

function fields(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const count = view.getUint16(0, false)
  const values = new Array(count)
  let offset = 2
  for (let index = 0; index < count; index += 1) {
    const type = payload[offset++]
    const length = view.getUint32(offset, false)
    offset += 4
    const bytes = payload.slice(offset, offset + length)
    offset += length
    if (type === 0) {
      values[index] = null
    } else if (type === 2) {
      values[index] = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, false)
    } else if (type === 3) {
      values[index] = bytes[0] === 1
    } else {
      values[index] = text(bytes)
    }
  }
  return values
}

function description(payload) {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const count = view.getUint16(0, false)
  const result = new Array(count)
  let offset = 2
  const readText = () => {
    const length = view.getUint32(offset, false)
    offset += 4
    const value = text(payload.slice(offset, offset + length))
    offset += length
    return value
  }
  for (let index = 0; index < count; index += 1) {
    result[index] = { name: readText(), type: readText(), table: readText(), nullable: payload[offset++] === 1 }
  }
  return result
}

export function decodeResult(bytes) {
  const result = { columns: [], fields: [], rows: [], commands: [], error: null }
  let offset = 0
  while (offset < bytes.length) {
    const type = bytes[offset]
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 1, 4).getUint32(0, false)
    const payload = bytes.slice(offset + 5, offset + 1 + length)
    if (type === MESSAGE.rowDescription) {
      result.fields = description(payload)
      result.columns = result.fields.map(field => field.name)
    } else if (type === MESSAGE.dataRow) {
      result.rows[result.rows.length] = fields(payload)
    } else if (type === MESSAGE.command) {
      result.commands[result.commands.length] = text(payload)
    } else if (type === MESSAGE.error) {
      const error = fields(payload)
      result.error = `${error[0]}: ${error[1]}`
    }
    offset += 1 + length
  }
  return result
}
