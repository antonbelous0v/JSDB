import { PageType } from "../constants.js"
import { SlottedPage } from "./slotted_page.js"

export class Heap {
  constructor(bufferPool, pageIds = []) {
    this.bufferPool = bufferPool
    this.pageIds = pageIds
  }

  insert(bytes) {
    for (let index = this.pageIds.length - 1; index >= 0; index -= 1) {
      const pageId = this.pageIds[index]
      const page = this.bufferPool.get(pageId)
      const slots = new SlottedPage(page)
      const slotId = slots.insert(bytes)
      this.bufferPool.unpin(page, slotId >= 0)
      if (slotId >= 0) {
        return { pageId, slotId }
      }
    }
    const page = this.bufferPool.allocate(PageType.HEAP)
    const slots = SlottedPage.initialize(page)
    const slotId = slots.insert(bytes)
    this.pageIds[this.pageIds.length] = page.id
    this.bufferPool.unpin(page, true)
    return { pageId: page.id, slotId }
  }

  get(rid) {
    const page = this.bufferPool.get(rid.pageId)
    try {
      return new Uint8Array(new SlottedPage(page).get(rid.slotId))
    } finally {
      this.bufferPool.unpin(page)
    }
  }

  remove(rid) {
    const page = this.bufferPool.get(rid.pageId)
    try {
      return new SlottedPage(page).remove(rid.slotId)
    } finally {
      this.bufferPool.unpin(page, true)
    }
  }

  update(rid, bytes) {
    const page = this.bufferPool.get(rid.pageId)
    try {
      const slots = new SlottedPage(page)
      const target = slots.get(rid.slotId)
      if (!target || target.length !== bytes.length) {
        throw new Error("Tuple update must preserve encoded length")
      }
      target.set(bytes)
      return true
    } finally {
      this.bufferPool.unpin(page, true)
    }
  }

  forEach(action) {
    for (const pageId of this.pageIds) {
      const page = this.bufferPool.get(pageId)
      let completed
      try {
        completed = new SlottedPage(page).forEach((slotId, bytes) => action(pageId, slotId, bytes))
      } finally {
        this.bufferPool.unpin(page)
      }
      if (!completed) {
        return false
      }
    }
    return true
  }
}
