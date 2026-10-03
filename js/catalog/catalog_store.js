import { PAGE_HEADER_SIZE, PAGE_SIZE, PageType } from "../constants.js"
import { CorruptionError } from "../errors.js"
import { decodeCatalog, encodeCatalog } from "./codec.js"

export class CatalogStore {
  constructor(bufferPool, pageIds = []) {
    this.bufferPool = bufferPool
    this.pageIds = pageIds
  }

  static load(bufferPool, rootPageId) {
    if (!rootPageId) {
      return { store: new CatalogStore(bufferPool), tables: [] }
    }
    const firstPage = bufferPool.get(rootPageId)
    if (firstPage.view.getUint16(14, true) & 1) {
      return CatalogStore.loadChain(bufferPool, firstPage)
    }
    try {
      const length = firstPage.view.getUint32(PAGE_HEADER_SIZE, true)
      if (length > firstPage.freeEnd - PAGE_HEADER_SIZE - 4) {
        throw new CorruptionError("Catalog exceeds page boundary")
      }
      const bytes = firstPage.bytes.subarray(PAGE_HEADER_SIZE + 4, PAGE_HEADER_SIZE + 4 + length)
      return { store: new CatalogStore(bufferPool, [rootPageId]), tables: decodeCatalog(bytes) }
    } finally {
      bufferPool.unpin(firstPage)
    }
  }

  static loadChain(bufferPool, firstPage) {
    const chunks = []
    const pageIds = []
    const visited = new Set()
    let page = firstPage
    while (page) {
      if (visited.has(page.id)) {
        bufferPool.unpin(page)
        throw new CorruptionError("Catalog page cycle")
      }
      visited.add(page.id)
      pageIds[pageIds.length] = page.id
      const length = page.view.getUint32(PAGE_HEADER_SIZE + 4, true)
      if (length > PAGE_SIZE - PAGE_HEADER_SIZE - 8) {
        bufferPool.unpin(page)
        throw new CorruptionError("Catalog chunk exceeds page boundary")
      }
      chunks[chunks.length] = new Uint8Array(page.bytes.subarray(PAGE_HEADER_SIZE + 8, PAGE_HEADER_SIZE + 8 + length))
      const next = page.view.getUint32(PAGE_HEADER_SIZE, true)
      bufferPool.unpin(page)
      page = next === 0xffffffff ? null : bufferPool.get(next)
    }
    const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return { store: new CatalogStore(bufferPool, pageIds), tables: decodeCatalog(bytes) }
  }

  persist(tables) {
    const bytes = encodeCatalog(tables)
    const capacity = PAGE_SIZE - PAGE_HEADER_SIZE - 8
    const required = Math.max(1, Math.ceil(bytes.length / capacity))
    while (this.pageIds.length < required) {
      const page = this.bufferPool.allocate(PageType.CATALOG)
      this.pageIds[this.pageIds.length] = page.id
      this.bufferPool.unpin(page)
    }
    for (let index = 0; index < required; index += 1) {
      this.writePage(index, required, bytes, capacity)
    }
    const newRoot = !this.bufferPool.pager.header.catalogRoot
    if (newRoot) {
      this.bufferPool.pager.header.catalogRoot = this.pageIds[0]
    }
    return newRoot
  }

  writePage(index, required, bytes, capacity) {
    const page = this.bufferPool.get(this.pageIds[index])
    const chunk = bytes.subarray(index * capacity, Math.min(bytes.length, (index + 1) * capacity))
    page.view.setUint16(14, 1, true)
    page.view.setUint32(PAGE_HEADER_SIZE, index + 1 < required ? this.pageIds[index + 1] : 0xffffffff, true)
    page.view.setUint32(PAGE_HEADER_SIZE + 4, chunk.length, true)
    page.bytes.fill(0, PAGE_HEADER_SIZE + 8)
    page.bytes.set(chunk, PAGE_HEADER_SIZE + 8)
    this.bufferPool.unpin(page, true)
  }
}
