import { WalType } from "../constants.js"

export class CommitCoordinator {
  constructor(host, pager, wal, bufferPool, transactions, catalog) {
    this.host = host
    this.pager = pager
    this.wal = wal
    this.bufferPool = bufferPool
    this.transactions = transactions
    this.catalog = catalog
  }

  commit(transaction) {
    if (transaction.readOnly) {
      this.transactions.commit(transaction)
      return
    }
    const headerChanged = this.catalog.persist()
    const pages = this.bufferPool.dirtyPages()
    if (headerChanged) {
      pages[pages.length] = this.pager.headerPage()
    }
    for (const page of pages) {
      page.pageLSN = this.wal.nextLSN
      page.seal()
      this.wal.append(transaction.id, WalType.PAGE_WRITE, page.id, new Uint8Array(page.bytes))
    }
    this.transactions.commit(transaction)
    this.host.debug.crashPoint("after-commit-before-page-flush")
    for (const page of pages) {
      this.pager.write(page)
    }
    this.pager.sync()
  }

  checkpoint() {
    this.bufferPool.flushAll()
    const lsn = this.wal.append(0n, WalType.CHECKPOINT, 0xffffffff, new Uint8Array())
    this.wal.sync(lsn)
    this.pager.header.checkpointLSN = lsn
    this.pager.persistHeader()
  }
}
