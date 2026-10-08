import { Parser } from "./sql/parser.js"
import { FixedCache } from "./sql/fixed_cache.js"
import { Binder } from "./sql/binder.js"
import { openDatabaseResources } from "./database_factory.js"
import { TableRegistry } from "./table_registry.js"
import { PreparedStatement } from "./prepared_statement.js"
import { SchemaExecutor } from "./execution/schema_executor.js"
import { MutationExecutor } from "./execution/mutation_executor.js"
import { QueryExecutor } from "./execution/query_executor.js"
import { StatementExecutor } from "./execution/statement_executor.js"
import { MaintenanceExecutor } from "./execution/maintenance_executor.js"
import { CommitCoordinator } from "./transaction/commit_coordinator.js"
import { TransactionSession } from "./transaction/session.js"

export class Database {
  constructor(resources) {
    Object.assign(this, resources)
    this.queryCache = new FixedCache(256)
    this.tableRegistry = new TableRegistry(this.catalog, this.bufferPool, this.transactions)
    this.tables = this.tableRegistry.tables
    this.commitCoordinator = new CommitCoordinator(this.host, this.pager, this.wal, this.bufferPool, this.transactions, this.catalog)
    this.session = this.createSession()
    const schema = new SchemaExecutor(this.catalog, this.tableRegistry, this.queryCache)
    const mutations = new MutationExecutor(this.catalog, this.tableRegistry)
    const queries = new QueryExecutor(this.catalog, this.tableRegistry)
    const maintenance = new MaintenanceExecutor(this.tableRegistry)
    this.statements = new StatementExecutor(schema, mutations, queries, maintenance)
    this.queriesExecuted = 0
  }

  static open(path, host = Host) {
    return new Database(openDatabaseResources(path, host))
  }

  get currentTransaction() {
    return this.session.current
  }

  createSession() {
    return new TransactionSession(this.transactions, this.commitCoordinator, this.queryCache, this.tableRegistry)
  }

  table(name) {
    return this.tableRegistry.table(name)
  }

  prepare(sql) {
    return new PreparedStatement(this, sql)
  }

  execute(sql, session = this.session) {
    const cached = this.queryCache.get(sql)
    if (cached) {
      return this.executeStatement(cached, true, session)
    }
    const results = []
    const statements = new Parser(sql).parse()
    if (statements.length === 1 && statements[0].type === "select") {
      const bound = new Binder(this.catalog).bind(statements[0])
      this.queryCache.set(sql, bound)
      return this.executeStatement(bound, true, session)
    }
    for (const statement of statements) {
      results[results.length] = this.executeStatement(statement, false, session)
    }
    return results.length === 1 ? results[0] : results
  }

  executeStatement(statement, isBound = false, session = this.session) {
    this.queriesExecuted += 1
    const bound = isBound ? statement : new Binder(this.catalog).bind(statement)
    return session.execute(bound, transaction => this.statements.execute(bound, transaction))
  }

  begin(readOnly = false) {
    return this.session.begin(readOnly)
  }

  commit() {
    return this.session.commit()
  }

  rollback() {
    return this.session.rollback()
  }

  checkpoint() {
    this.commitCoordinator.checkpoint()
  }

  stats() {
    return { bufferPoolHits: this.bufferPool.hits, bufferPoolMisses: this.bufferPool.misses, pagesRead: this.pager.pagesRead, pagesWritten: this.pager.pagesWritten, walBytesWritten: this.wal.bytesWritten, walFsyncs: this.wal.fsyncs, transactionsCommitted: this.transactions.committed, transactionsAborted: this.transactions.aborted, queriesExecuted: this.queriesExecuted, btreeSplits: [...this.tables.values()].reduce((total, table) => total + [...table.indexes.values()].reduce((sum, index) => sum + index.tree.splits, 0), 0) }
  }

  close() {
    if (this.currentTransaction) {
      this.rollback()
    }
    this.checkpoint()
    this.wal.close()
    this.pager.close()
  }
}
