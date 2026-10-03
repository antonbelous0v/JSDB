export class StatementExecutor {
  constructor(schema, mutations, queries) {
    this.schema = schema
    this.mutations = mutations
    this.queries = queries
  }

  execute(statement, transaction) {
    switch (statement.type) {
      case "create_table":
        return this.schema.createTable(statement, transaction)
      case "drop_table":
        return this.schema.dropTable(statement, transaction)
      case "create_index":
        return this.schema.createIndex(statement, transaction)
      case "drop_index":
        return this.schema.dropIndex(statement, transaction)
      case "insert":
        return this.mutations.insert(statement, transaction)
      case "update":
        return this.mutations.update(statement, transaction)
      case "delete":
        return this.mutations.delete(statement, transaction)
      case "select":
        return this.queries.select(statement, transaction)
      case "explain":
        return this.queries.explain(statement.statement)
      default:
        throw new Error(`Unsupported statement ${statement.type}`)
    }
  }
}
