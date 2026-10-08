import { ValidationError } from "../errors.js"
import { FixedList } from "./fixed_list.js"

export class BufferPool {
  constructor(pager, capacity = 128, beforeFlush = () => {}, noSteal = false) {
    if (!Number.isSafeInteger(capacity) || capacity < 2) {
      throw new ValidationError("Buffer pool capacity must be at least two")
    }
    this.pager = pager
    this.capacity = capacity
    this.beforeFlush = beforeFlush
    this.noSteal = noSteal
    this.frames = new Map()
    this.clock = new FixedList(capacity)
    this.hand = 0
    this.hits = 0
    this.misses = 0
  }

  get(pageId) {
    let page = this.frames.get(pageId)
    if (page) {
      this.hits += 1
      page.pinCount += 1
      page.referenced = true
      return page
    }
    this.misses += 1
    if (this.frames.size >= this.capacity) {
      this.evict()
    }
    page = this.pager.read(pageId)
    page.pinCount = 1
    this.frames.set(pageId, page)
    if (this.clock.length === this.clock.values.length) {
      this.clock.grow(this.clock.length * 2)
    }
    this.clock.add(pageId)
    return page
  }

  allocate(type) {
    if (this.frames.size >= this.capacity) {
      this.evict()
    }
    const page = this.pager.allocate(type)
    page.pinCount = 1
    page.dirty = true
    this.frames.set(page.id, page)
    if (this.clock.length === this.clock.values.length) {
      this.clock.grow(this.clock.length * 2)
    }
    this.clock.add(page.id)
    return page
  }

  unpin(page, dirty = false) {
    if (page.pinCount <= 0) {
      throw new ValidationError(`Page ${page.id} is not pinned`)
    }
    page.pinCount -= 1
    page.dirty ||= dirty
  }

  evict() {
    let inspected = 0
    while (inspected < this.clock.length * 2) {
      const pageId = this.clock.at(this.hand)
      const page = this.frames.get(pageId)
      this.hand = (this.hand + 1) % this.clock.length
      inspected += 1
      if (page.pinCount) {
        continue
      }
      if (page.referenced) {
        page.referenced = false
        continue
      }
      if (this.noSteal && page.dirty) {
        continue
      }
      this.flushPage(page)
      this.frames.delete(pageId)
      this.clock.removeAt(this.hand === 0 ? this.clock.length - 1 : this.hand - 1)
      if (this.hand >= this.clock.length) {
        this.hand = 0
      }
      return
    }
    if (!this.noSteal) {
      throw new Error("All buffer pool pages are pinned")
    }
  }

  flushPage(page) {
    if (!page.dirty) {
      return
    }
    this.beforeFlush(page.pageLSN)
    this.pager.write(page)
  }

  flushAll() {
    for (const page of this.frames.values()) {
      this.flushPage(page)
    }
    this.pager.sync()
  }

  dirtyPages() {
    const pages = []
    for (const page of this.frames.values()) {
      if (page.dirty) {
        pages[pages.length] = page
      }
    }
    return pages
  }
}
