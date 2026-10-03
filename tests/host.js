import fs from "node:fs"

const descriptors = new Set()

export function createHost() {
  return {
    fs: {
      O_RDONLY: fs.constants.O_RDONLY,
      O_RDWR: fs.constants.O_RDWR,
      O_CREAT: fs.constants.O_CREAT,
      open(path, flags) {
        const fd = fs.openSync(path, flags, 0o644)
        descriptors.add(fd)
        return fd
      },
      lockExclusive() {},
      close(fd) {
        if (descriptors.delete(fd)) {
          fs.closeSync(fd)
        }
      },
      pread(fd, buffer, bufferOffset, length, fileOffset) {
        return fs.readSync(fd, buffer, bufferOffset, length, fileOffset)
      },
      pwrite(fd, buffer, bufferOffset, length, fileOffset) {
        return fs.writeSync(fd, buffer, bufferOffset, length, fileOffset)
      },
      fsync(fd) {
        fs.fsyncSync(fd)
      },
      fdatasync(fd) {
        fs.fdatasyncSync(fd)
      },
      truncate(fd, size) {
        fs.ftruncateSync(fd, size)
      },
      size(fd) {
        return fs.fstatSync(fd).size
      },
      rename(oldPath, newPath) {
        fs.renameSync(oldPath, newPath)
      },
      unlink(path) {
        fs.unlinkSync(path)
      },
      exists(path) {
        return fs.existsSync(path)
      },
      mkdir(path) {
        fs.mkdirSync(path, { recursive: true })
      },
    },
    time: { monotonicNs: () => process.hrtime.bigint(), unixNs: () => BigInt(Date.now()) * 1000000n },
    debug: { crashPoint() {} },
    log: { trace() {}, debug() {}, info() {}, warn() {}, error() {} },
    process: { argv: [], pid: process.pid, exit: code => process.exit(code) },
  }
}
