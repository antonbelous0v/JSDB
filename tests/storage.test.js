import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { PageType } from "../js/constants.js"
import { Pager } from "../js/storage/pager.js"
import { BufferPool } from "../js/storage/buffer_pool.js"
import { FixedList } from "../js/storage/fixed_list.js"
import { SlottedPage } from "../js/storage/slotted_page.js"
import { createHost } from "./host.js"
import { CorruptionError } from "../js/errors.js"

test("pager persists slotted pages", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mydb-storage-"))
  const file = path.join(directory, "data.db")
  const host = createHost()
  const pager = Pager.open(host, file)
  const pool = new BufferPool(pager, 2)
  const page = pool.allocate(PageType.HEAP)
  const slots = SlottedPage.initialize(page)
  assert.equal(slots.insert(new Uint8Array([1, 2, 3])), 0)
  const id = page.id
  pool.unpin(page, true)
  pool.flushAll()
  const restored = pager.read(id)
  assert.deepEqual([...new SlottedPage(restored).get(0)], [1, 2, 3])
  pager.close()
  fs.rmSync(directory, { recursive: true })
})

test("pager refuses corrupted page contents", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mydb-corrupt-"))
  const file = path.join(directory, "data.db")
  const host = createHost()
  let pager = Pager.open(host, file)
  const page = pager.allocate(PageType.HEAP)
  pager.write(page)
  pager.close()
  const fd = fs.openSync(file, "r+")
  fs.writeSync(fd, new Uint8Array([255]), 0, 1, page.id * 8192 + 100)
  fs.closeSync(fd)
  pager = Pager.open(host, file)
  assert.throws(() => pager.read(page.id), CorruptionError)
  pager.close()
  fs.rmSync(directory, { recursive: true })
})

test("buffer pool evicts unpinned dirty pages", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mydb-buffer-"))
  const file = path.join(directory, "data.db")
  const pager = Pager.open(createHost(), file)
  const pool = new BufferPool(pager, 2)
  const first = pool.allocate(PageType.HEAP)
  first.bytes[100] = 77
  pool.unpin(first, true)
  const second = pool.allocate(PageType.HEAP)
  pool.unpin(second)
  const third = pool.allocate(PageType.HEAP)
  pool.unpin(third)
  assert.equal(pager.read(first.id).bytes[100], 77)
  pager.close()
  fs.rmSync(directory, { recursive: true })
})

test("no-steal buffer pool retains dirty pages beyond capacity", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mydb-no-steal-"))
  const file = path.join(directory, "data.db")
  const pager = Pager.open(createHost(), file)
  const pool = new BufferPool(pager, 2, () => {}, true)
  const first = pool.allocate(PageType.HEAP)
  first.bytes[100] = 91
  pool.unpin(first, true)
  const second = pool.allocate(PageType.HEAP)
  pool.unpin(second)
  const third = pool.allocate(PageType.HEAP)
  pool.unpin(third)
  assert.equal(pool.frames.size, 3)
  assert.notEqual(pager.read(first.id).bytes[100], 91)
  pool.flushAll()
  assert.equal(pager.read(first.id).bytes[100], 91)
  pager.close()
  fs.rmSync(directory, { recursive: true })
})

test("allocated pages reach disk before the header references them", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mydb-allocation-"))
  const file = path.join(directory, "data.db")
  const host = createHost()
  const pager = Pager.open(host, file)
  const page = pager.allocate(PageType.CATALOG)
  assert.equal(page.id, 1)
  assert.equal(host.fs.size(pager.fd), 2 * 8192)
  pager.close()
  const reopened = Pager.open(host, file)
  assert.equal(reopened.read(1).type, PageType.CATALOG)
  reopened.close()
  fs.rmSync(directory, { recursive: true })
})

test("fixed lists reject capacity growth", () => {
  const list = new FixedList(2)
  list.add(1)
  list.add(2)
  assert.throws(() => list.add(3), /capacity/)
  assert.equal(list.removeAt(0), 1)
  assert.equal(list.at(0), 2)
})
