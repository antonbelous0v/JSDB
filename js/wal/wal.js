import { WalRecord, WAL_HEADER_SIZE } from "./record.js"
import { CorruptionError } from "../errors.js"

const BUFFERED_READ_LIMIT = 16 * 1024 * 1024

export class WriteAheadLog {
  constructor(host, path, fd, offset, nextLSN) {
    this.host = host
    this.path = path
    this.fd = fd
    this.offset = offset
    this.nextLSN = nextLSN
    this.durableLSN = 0n
    this.bytesWritten = 0
    this.fsyncs = 0
  }

  static open(host, path) {
    const fd = host.fs.open(path, host.fs.O_RDWR | host.fs.O_CREAT)
    let size = host.fs.size(fd)
    let nextLSN = 1n
    if (size) {
      const records = [...WriteAheadLog.readAll(host, fd, size)]
      let validSize = 0
      for (let index = 0; index < records.length; index += 1) {
        validSize += WAL_HEADER_SIZE + records[index].payload.length
      }
      if (validSize < size) {
        host.fs.truncate(fd, validSize)
        size = validSize
      }
      if (records.length) {
        nextLSN = records.at(-1).lsn + 1n
      }
    }
    return new WriteAheadLog(host, path, fd, size, nextLSN)
  }

  append(transactionId, type, pageId, payload) {
    const record = new WalRecord({ lsn: this.nextLSN++, transactionId, type, pageId, payload })
    const bytes = record.encode()
    if (this.host.fs.pwrite(this.fd, bytes, 0, bytes.length, this.offset) !== bytes.length) {
      throw new Error("Short WAL write")
    }
    this.offset += bytes.length
    this.bytesWritten += bytes.length
    return record.lsn
  }

  sync(lsn = this.nextLSN - 1n) {
    if (lsn <= this.durableLSN) {
      return
    }
    this.host.fs.fsync(this.fd)
    this.host.debug.crashPoint("after-wal-fsync")
    this.durableLSN = lsn
    this.fsyncs += 1
  }

  * records() {
    yield* WriteAheadLog.readAll(this.host, this.fd, this.offset)
  }

  static* readAll(host, fd, size) {
    if (size <= BUFFERED_READ_LIMIT) {
      const bytes = new Uint8Array(size)
      if (host.fs.pread(fd, bytes, 0, size, 0) !== size) {
        throw new CorruptionError("Cannot read WAL")
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      let offset = 0
      while (offset < size) {
        if (size - offset < WAL_HEADER_SIZE) {
          return
        }
        const length = view.getUint32(offset + 4, true)
        if (length < WAL_HEADER_SIZE || offset + length > size) {
          return
        }
        yield WalRecord.decode(bytes.subarray(offset, offset + length))
        offset += length
      }
      return
    }
    let offset = 0
    const header = new Uint8Array(WAL_HEADER_SIZE)
    const view = new DataView(header.buffer)
    while (offset < size) {
      if (size - offset < WAL_HEADER_SIZE) {
        return
      }
      if (host.fs.pread(fd, header, 0, header.length, offset) !== header.length) {
        throw new CorruptionError("Cannot read WAL header")
      }
      const length = view.getUint32(4, true)
      if (length < WAL_HEADER_SIZE || offset + length > size) {
        return
      }
      const bytes = new Uint8Array(length)
      if (host.fs.pread(fd, bytes, 0, length, offset) !== length) {
        throw new CorruptionError("Cannot read WAL record")
      }
      yield WalRecord.decode(bytes)
      offset += length
    }
  }

  close() {
    this.host.fs.close(this.fd)
  }
}
