import { ValidationError } from "../errors.js"

export function compareKeys(left, right) {
  if (Array.isArray(left) && Array.isArray(right)) {
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      const order = compareKeys(left[index], right[index])
      if (order) {
        return order
      }
    }
    return Math.sign(left.length - right.length)
  }
  if (typeof left !== typeof right) {
    throw new ValidationError("Cannot compare keys of different types")
  }
  if (typeof left === "number" && (Number.isNaN(left) || Number.isNaN(right))) {
    throw new ValidationError("NaN cannot be indexed")
  }
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

export function lowerBound(values, key) {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = low + ((high - low) >> 1)
    if (compareKeys(values[middle], key) < 0) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  return low
}
