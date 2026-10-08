import { BufferPool } from "./storage/buffer_pool.js"
import { Pager } from "./storage/pager.js"
import { Page } from "./storage/page.js"
import { WriteAheadLog } from "./wal/wal.js"
import { Recovery } from "./wal/recovery.js"
import { LockTable } from "./transaction/lock_table.js"
import { TransactionManager } from "./transaction/transaction.js"
import { Catalog } from "./catalog/catalog.js"
import { WalType } from "./constants.js"

export function openDatabaseResources(path, host) {
  const pager = Pager.open(host, path)
  let wal = null
  try {
    wal = WriteAheadLog.open(host, `${path}.wal`)
    new Recovery(wal, {
      redo(record) {
        if (record.type !== WalType.PAGE_WRITE) {
          return
        }
        let current = null
        try {
          current = pager.read(record.pageId)
        } catch {}
        if (!current || current.pageLSN < record.lsn) {
          pager.write(Page.decode(new Uint8Array(record.payload), record.pageId))
        }
      },
      undo() {},
    }).run(pager.header.checkpointLSN)
    pager.sync()
    pager.reloadHeader()
    const bufferPool = new BufferPool(pager, 128, lsn => wal.sync(lsn), true)
    const transactions = new TransactionManager(wal, new LockTable())
    transactions.restore(wal.records())
    const catalog = Catalog.load(bufferPool, pager.header.catalogRoot)
    return { host, path, pager, wal, bufferPool, transactions, catalog }
  } catch (error) {
    wal?.close()
    pager.close()
    throw error
  }
}
