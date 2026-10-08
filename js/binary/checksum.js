const table = new Uint32Array(256)

for (let index = 0; index < 256; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0x82f63b78 ^ (value >>> 1) : value >>> 1
  }
  table[index] = value >>> 0
}

const slicingTables = [table]
for (let slice = 1; slice < 8; slice += 1) {
  const previous = slicingTables[slice - 1]
  const current = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    const value = previous[index]
    current[index] = (table[value & 0xff] ^ (value >>> 8)) >>> 0
  }
  slicingTables[slice] = current
}

export function crc32c(bytes, start = 0, end = bytes.length) {
  let value = 0xffffffff
  let index = start
  const blockEnd = end - ((end - start) & 7)
  const table1 = slicingTables[1]
  const table2 = slicingTables[2]
  const table3 = slicingTables[3]
  const table4 = slicingTables[4]
  const table5 = slicingTables[5]
  const table6 = slicingTables[6]
  const table7 = slicingTables[7]
  while (index < blockEnd) {
    value ^= bytes[index] | (bytes[index + 1] << 8) | (bytes[index + 2] << 16) | (bytes[index + 3] << 24)
    value = table7[value & 0xff] ^ table6[(value >>> 8) & 0xff] ^ table5[(value >>> 16) & 0xff] ^ table4[value >>> 24] ^ table3[bytes[index + 4]] ^ table2[bytes[index + 5]] ^ table1[bytes[index + 6]] ^ table[bytes[index + 7]]
    index += 8
  }
  while (index < end) {
    value = table[(value ^ bytes[index]) & 0xff] ^ (value >>> 8)
    index += 1
  }
  return (value ^ 0xffffffff) >>> 0
}
