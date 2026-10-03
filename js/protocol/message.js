import { decodeUtf8, encodeUtf8 } from "../binary/utf8.js"

export const MessageType = Object.freeze({
  STARTUP: 86,
  QUERY: 81,
  METADATA: 77,
  AUTHENTICATION_OK: 82,
  ROW_DESCRIPTION: 84,
  DATA_ROW: 68,
  COMMAND_COMPLETE: 67,
  ERROR_RESPONSE: 69,
  READY_FOR_QUERY: 90,
})

export const PROTOCOL_VERSION = 2
const MAX_MESSAGE_SIZE = 16 * 1024 * 1024

export function encodeStartup() {
  const payload = new Uint8Array(4)
  new DataView(payload.buffer).setUint32(0, PROTOCOL_VERSION, false)
  return encodeMessage(MessageType.STARTUP, payload)
}

export function encodeMessage(type, payload = new Uint8Array()) {
  const message = new Uint8Array(payload.length + 5)
  message[0] = type
  new DataView(message.buffer).setUint32(1, payload.length + 4, false)
  message.set(payload, 5)
  return message
}

export function encodeTextMessage(type, value) {
  return encodeMessage(type, encodeUtf8(value))
}

export function decodeTextMessage(message) {
  return decodeUtf8(message.payload)
}

export class MessageDecoder {
  constructor() {
    this.bytes = new Uint8Array()
  }

  write(chunk) {
    const joined = new Uint8Array(this.bytes.length + chunk.length)
    joined.set(this.bytes)
    joined.set(chunk, this.bytes.length)
    this.bytes = joined
    const messages = []
    let offset = 0
    while (this.bytes.length - offset >= 5) {
      const length = new DataView(this.bytes.buffer, this.bytes.byteOffset + offset + 1, 4).getUint32(0, false)
      if (length < 4 || length > MAX_MESSAGE_SIZE) {
        throw new Error("Invalid protocol message length")
      }
      const end = offset + 1 + length
      if (end > this.bytes.length) {
        break
      }
      messages[messages.length] = { type: this.bytes[offset], payload: this.bytes.slice(offset + 5, end) }
      offset = end
    }
    this.bytes = this.bytes.slice(offset)
    return messages
  }
}
