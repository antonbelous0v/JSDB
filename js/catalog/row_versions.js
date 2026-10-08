import { isVisible } from "../transaction/snapshot.js"

export class RowVersions {
  constructor(transactionStates) {
    this.transactionStates = transactionStates
    this.pages = []
  }

  set(rid, version) {
    let page = this.pages[rid.pageId]
    if (!page) {
      page = []
      this.pages[rid.pageId] = page
    }
    page[rid.slotId] = version
  }

  get(rid) {
    return this.pages[rid.pageId][rid.slotId]
  }

  remove(rid) {
    this.pages[rid.pageId][rid.slotId] = undefined
  }

  visible(rid, transaction) {
    const version = this.get(rid)
    return version && isVisible(version, transaction.snapshot, transaction.id, this.transactionStates) ? version : null
  }

  forEach(transaction, action) {
    for (let pageId = 0; pageId < this.pages.length; pageId += 1) {
      const page = this.pages[pageId]
      if (!page) {
        continue
      }
      for (let slotId = 0; slotId < page.length; slotId += 1) {
        const rid = { pageId, slotId }
        const version = this.visible(rid, transaction)
        if (version && action({ rid, row: version.row }) === false) {
          return false
        }
      }
    }
    return true
  }

  forEachRow(transaction, action) {
    for (let pageId = 0; pageId < this.pages.length; pageId += 1) {
      const page = this.pages[pageId]
      if (!page) {
        continue
      }
      for (let slotId = 0; slotId < page.length; slotId += 1) {
        const version = page[slotId]
        if (version && isVisible(version, transaction.snapshot, transaction.id, this.transactionStates) && action(version.row) === false) {
          return false
        }
      }
    }
    return true
  }
}
