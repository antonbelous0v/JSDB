export class MaintenanceExecutor {
  constructor(tables) {
    this.tables = tables
  }

  vacuum(statement, transaction) {
    const rows = this.tables.table(statement.table).vacuum(transaction)
    return { status: "VACUUM", rows }
  }
}
