import { ValidationError } from "../errors.js"

export class FixedList {
  constructor(capacity) {
    this.values = new Array(capacity)
    this.length = 0
  }

  add(value) {
    if (this.length === this.values.length) {
      throw new ValidationError("Fixed list capacity exceeded")
    }
    this.values[this.length] = value
    this.length += 1
  }

  grow(capacity) {
    if (!Number.isSafeInteger(capacity) || capacity <= this.values.length) {
      throw new ValidationError("Fixed list growth must increase capacity")
    }
    const values = new Array(capacity)
    for (let index = 0; index < this.length; index += 1) {
      values[index] = this.values[index]
    }
    this.values = values
  }

  removeAt(index) {
    if (index < 0 || index >= this.length) {
      throw new ValidationError("Fixed list index is out of range")
    }
    const value = this.values[index]
    let cursor = index
    while (cursor + 1 < this.length) {
      this.values[cursor] = this.values[cursor + 1]
      cursor += 1
    }
    this.length -= 1
    this.values[this.length] = undefined
    return value
  }

  at(index) {
    return this.values[index]
  }
}
