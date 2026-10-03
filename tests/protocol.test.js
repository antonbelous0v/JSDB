import assert from "node:assert/strict"
import test from "node:test"

import { MessageDecoder, MessageType, encodeStartup, encodeTextMessage, decodeTextMessage } from "../js/protocol/message.js"
import { resultMessages } from "../js/protocol/result.js"

test("protocol decoder preserves fragmented messages", () => {
  const encoded = encodeTextMessage(MessageType.QUERY, "SELECT 1")
  const decoder = new MessageDecoder()
  assert.deepEqual(decoder.write(encoded.slice(0, 3)), [])
  const messages = decoder.write(encoded.slice(3))
  assert.equal(messages.length, 1)
  assert.equal(messages[0].type, MessageType.QUERY)
  assert.equal(decodeTextMessage(messages[0]), "SELECT 1")
})

test("protocol decoder rejects oversized frames", () => {
  const bytes = new Uint8Array(5)
  new DataView(bytes.buffer).setUint32(1, 16 * 1024 * 1024 + 1, false)
  assert.throws(() => new MessageDecoder().write(bytes), /Invalid protocol message length/)
})

test("startup identifies the protocol version", () => {
  const message = new MessageDecoder().write(encodeStartup())[0]
  assert.equal(message.type, MessageType.STARTUP)
  assert.equal(new DataView(message.payload.buffer, message.payload.byteOffset, 4).getUint32(0, false), 2)
})

test("query results use row and completion messages", () => {
  const messages = resultMessages([[1n, "Ada"], [2n, "Grace"]])
  assert.deepEqual(messages.map(message => message[0]), [MessageType.ROW_DESCRIPTION, MessageType.DATA_ROW, MessageType.DATA_ROW, MessageType.COMMAND_COMPLETE])
})
