import { PAGE_HEADER_SIZE, PAGE_SIZE } from "../constants.js"
import { ValidationError } from "../errors.js"

const SLOT_SIZE = 4
const SLOT_COUNT_OFFSET = 32

export class SlottedPage {
  constructor(page) {
    this.page = page
    this.view = page.view
  }

  static initialize(page) {
    page.freeStart = PAGE_HEADER_SIZE
    page.freeEnd = PAGE_SIZE
    page.view.setUint16(SLOT_COUNT_OFFSET, 0, true)
    return new SlottedPage(page)
  }

  get slotCount() {
    return this.view.getUint16(SLOT_COUNT_OFFSET, true)
  }

  get freeSpace() {
    return this.page.freeEnd - this.page.freeStart
  }

  insert(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > 0xffff) {
      throw new ValidationError("Invalid tuple")
    }
    let slotId = this.slotCount
    for (let index = 0; index < slotId; index += 1) {
      if (this.slot(index).length === 0) {
        slotId = index
        break
      }
    }
    const reused = slotId < this.slotCount
    if (this.freeSpace < bytes.length + (reused ? 0 : SLOT_SIZE)) {
      return -1
    }
    const tupleOffset = this.page.freeStart
    this.page.bytes.set(bytes, tupleOffset)
    this.page.freeStart = tupleOffset + bytes.length
    if (!reused) {
      this.page.freeEnd -= SLOT_SIZE
      this.view.setUint16(SLOT_COUNT_OFFSET, slotId + 1, true)
    }
    const slotOffset = this.slotOffset(slotId)
    this.view.setUint16(slotOffset, tupleOffset, true)
    this.view.setUint16(slotOffset + 2, bytes.length, true)
    this.page.dirty = true
    return slotId
  }

  get(slotId) {
    const slot = this.slot(slotId)
    if (!slot.length) {
      return null
    }
    return this.page.bytes.subarray(slot.offset, slot.offset + slot.length)
  }

  remove(slotId) {
    const slotOffset = this.slotOffset(slotId)
    if (this.view.getUint16(slotOffset + 2, true) === 0) {
      return false
    }
    this.view.setUint16(slotOffset + 2, 0, true)
    this.page.dirty = true
    return true
  }

  compact() {
    let cursor = PAGE_HEADER_SIZE
    for (let slotId = 0; slotId < this.slotCount; slotId += 1) {
      const slot = this.slot(slotId)
      if (!slot.length) {
        continue
      }
      if (slot.offset !== cursor) {
        this.page.bytes.copyWithin(cursor, slot.offset, slot.offset + slot.length)
        this.view.setUint16(this.slotOffset(slotId), cursor, true)
      }
      cursor += slot.length
    }
    this.page.freeStart = cursor
    this.page.dirty = true
  }

  forEach(action) {
    for (let slotId = 0; slotId < this.slotCount; slotId += 1) {
      const bytes = this.get(slotId)
      if (bytes && action(slotId, bytes) === false) {
        return false
      }
    }
    return true
  }

  slot(slotId) {
    const offset = this.slotOffset(slotId)
    return { offset: this.view.getUint16(offset, true), length: this.view.getUint16(offset + 2, true) }
  }

  slotOffset(slotId) {
    if (!Number.isSafeInteger(slotId) || slotId < 0 || slotId >= this.slotCount) {
      throw new ValidationError(`Invalid slot ${slotId}`)
    }
    return PAGE_SIZE - (slotId + 1) * SLOT_SIZE
  }
}
