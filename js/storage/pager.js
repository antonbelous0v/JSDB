import { DATABASE_HEADER_SIZE, PAGE_SIZE, PageType } from "../constants.js"
import { DatabaseHeader } from "./database_header.js"
import { Page } from "./page.js"
import { CorruptionError } from "../errors.js"

export class Pager {
  constructor(host, path, fd, header) {
    this.host = host
    this.path = path
    this.fd = fd
    this.header = header
    this.freePages = []
    this.pagesRead = 0
    this.pagesWritten = 0
  }

  static open(host, path) {
    const flags = host.fs.O_RDWR | host.fs.O_CREAT
    const existed = host.fs.exists(path)
    const fd = host.fs.open(path, flags)
    try {
      host.fs.lockExclusive(fd)
    } catch (error) {
      host.fs.close(fd)
      throw new Error(`Database is already open by another process: ${path}`, { cause: error })
    }
    try {
      if (!existed || host.fs.size(fd) === 0) {
        const header = new DatabaseHeader({ databaseId: host.time.unixNs() })
        const pager = new Pager(host, path, fd, header)
        const meta = Page.create(0, PageType.META)
        header.encode(meta.bytes.subarray(40, 40 + DATABASE_HEADER_SIZE))
        meta.seal()
        pager.write(meta)
        host.fs.fsync(fd)
        return pager
      }
      if (host.fs.size(fd) % PAGE_SIZE !== 0) {
        throw new CorruptionError("Database file is not page aligned")
      }
      const bytes = new Uint8Array(PAGE_SIZE)
      if (host.fs.pread(fd, bytes, 0, PAGE_SIZE, 0) !== PAGE_SIZE) {
        throw new CorruptionError("Cannot read database header")
      }
      const page = Page.decode(bytes, 0)
      return new Pager(host, path, fd, DatabaseHeader.decode(page.bytes.subarray(40, 40 + DATABASE_HEADER_SIZE)))
    } catch (error) {
      host.fs.close(fd)
      throw error
    }
  }

  read(pageId) {
    if (pageId >= this.header.pageCount) {
      throw new CorruptionError(`Page ${pageId} does not exist`)
    }
    const bytes = new Uint8Array(PAGE_SIZE)
    if (this.host.fs.pread(this.fd, bytes, 0, PAGE_SIZE, pageId * PAGE_SIZE) !== PAGE_SIZE) {
      throw new CorruptionError(`Short read for page ${pageId}`)
    }
    this.pagesRead += 1
    return Page.decode(bytes, pageId)
  }

  write(page) {
    page.seal()
    if (this.host.fs.pwrite(this.fd, page.bytes, 0, PAGE_SIZE, page.id * PAGE_SIZE) !== PAGE_SIZE) {
      throw new Error(`Short write for page ${page.id}`)
    }
    this.pagesWritten += 1
    page.dirty = false
  }

  allocate(type) {
    const reusedPageId = this.freePages.length ? this.freePages[this.freePages.length - 1] : undefined
    if (this.freePages.length) {
      this.freePages.length -= 1
    }
    const pageId = reusedPageId ?? this.header.pageCount
    const page = Page.create(pageId, type)
    this.write(page)
    this.host.fs.fdatasync(this.fd)
    if (reusedPageId === undefined) {
      this.header.pageCount += 1
      this.persistHeader()
    }
    return page
  }

  free(pageId) {
    if (pageId <= 0 || pageId >= this.header.pageCount || this.freePages.includes(pageId)) {
      throw new CorruptionError(`Invalid free page ${pageId}`)
    }
    this.freePages[this.freePages.length] = pageId
  }

  persistHeader() {
    const page = this.headerPage()
    this.write(page)
    this.sync()
  }

  headerPage() {
    const page = this.read(0)
    this.header.encode(page.bytes.subarray(40, 40 + DATABASE_HEADER_SIZE))
    return page
  }

  reloadHeader() {
    this.header = DatabaseHeader.decode(this.read(0).bytes.subarray(40, 40 + DATABASE_HEADER_SIZE))
  }

  sync() {
    this.host.fs.fsync(this.fd)
  }

  close() {
    this.host.fs.close(this.fd)
  }
}
