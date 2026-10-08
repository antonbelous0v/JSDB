import { crc32c } from "../binary/checksum.js"
import { WAL_MAGIC } from "../constants.js"
import { CorruptionError, ValidationError } from "../errors.js"

export const WAL_HEADER_SIZE = 40

export class WalRecord {
  constructor({ lsn, transactionId, type, pageId = 0xffffffff, payload = new Uint8Array() }) {
    if (!(payload instanceof Uint8Array)) {
      throw new ValidationError("WAL payload must be bytes")
    }
    this.lsn = BigInt(lsn)
    this.transactionId = BigInt(transactionId)
    this.type = type
    this.pageId = pageId
    this.payload = payload
  }

  encode() {
    const bytes = new Uint8Array(WAL_HEADER_SIZE + this.payload.length)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, WAL_MAGIC, true)
    view.setUint32(4, bytes.length, true)
    view.setBigUint64(8, this.lsn, true)
    view.setBigUint64(16, this.transactionId, true)
    view.setUint16(24, this.type, true)
    view.setUint16(26, 0, true)
    view.setUint32(28, this.pageId, true)
    view.setUint32(32, this.payload.length, true)
    bytes.set(this.payload, WAL_HEADER_SIZE)
    view.setUint32(36, crc32c(bytes), true)
    return bytes
  }

  static decode(bytes) {
    if (bytes.length < WAL_HEADER_SIZE) {
      throw new CorruptionError("Invalid WAL record length")
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    if (view.getUint32(0, true) !== WAL_MAGIC) {
      throw new CorruptionError("Invalid WAL magic")
    }
    const length = view.getUint32(4, true)
    if (length !== bytes.length || length < WAL_HEADER_SIZE) {
      throw new CorruptionError("Invalid WAL record length")
    }
    const lsn = view.getBigUint64(8, true)
    const transactionId = view.getBigUint64(16, true)
    const type = view.getUint16(24, true)
    const pageId = view.getUint32(28, true)
    const payloadLength = view.getUint32(32, true)
    const stored = view.getUint32(36, true)
    view.setUint32(36, 0, true)
    const actual = crc32c(bytes)
    view.setUint32(36, stored, true)
    if (stored !== actual || payloadLength !== length - WAL_HEADER_SIZE) {
      throw new CorruptionError("WAL checksum mismatch")
    }
    return new WalRecord({ lsn, transactionId, type, pageId, payload: bytes.subarray(WAL_HEADER_SIZE) })
  }
}
