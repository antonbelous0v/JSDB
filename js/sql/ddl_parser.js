export class DdlParser {
  constructor(tokens) {
    this.tokens = tokens
  }

  create() {
    const unique = this.tokens.match("UNIQUE")
    if (this.tokens.match("TABLE")) {
      return this.createTable()
    }
    this.tokens.expect("INDEX")
    const name = this.tokens.identifier()
    this.tokens.expect("ON")
    const table = this.tokens.identifier()
    this.tokens.expect("(")
    const columns = this.tokens.list(() => this.tokens.identifier())
    this.tokens.expect(")")
    return { type: "create_index", name, table, columns, unique }
  }

  createTable() {
    const name = this.tokens.identifier()
    this.tokens.expect("(")
    const columns = []
    const primaryKey = []
    do {
      if (this.tokens.match("PRIMARY")) {
        this.tablePrimaryKey(primaryKey)
      } else {
        columns[columns.length] = this.column()
      }
    } while (this.tokens.match(","))
    this.tokens.expect(")")
    const unique = []
    for (const column of columns) {
      if (column.primary) {
        primaryKey[primaryKey.length] = column.name
      }
      if (column.unique) {
        unique[unique.length] = [column.name]
      }
    }
    return { type: "create_table", name, columns, primaryKey, unique }
  }

  tablePrimaryKey(primaryKey) {
    this.tokens.expect("KEY")
    this.tokens.expect("(")
    const keys = this.tokens.list(() => this.tokens.identifier())
    this.tokens.expect(")")
    for (const key of keys) {
      primaryKey[primaryKey.length] = key
    }
  }

  column() {
    const column = { name: this.tokens.identifier(), dataType: this.tokens.take().value, nullable: true, primary: false, unique: false, references: null }
    while (!this.tokens.at(",") && !this.tokens.at(")")) {
      this.columnConstraint(column)
    }
    return column
  }

  columnConstraint(column) {
    if (this.tokens.match("NOT")) {
      this.tokens.expect("NULL")
      column.nullable = false
      return
    }
    if (this.tokens.match("PRIMARY")) {
      this.tokens.expect("KEY")
      column.primary = true
      column.nullable = false
      return
    }
    if (this.tokens.match("UNIQUE")) {
      column.unique = true
      return
    }
    if (this.tokens.match("REFERENCES")) {
      const table = this.tokens.identifier()
      this.tokens.expect("(")
      const referenced = this.tokens.identifier()
      this.tokens.expect(")")
      column.references = { table, column: referenced }
      return
    }
    throw this.tokens.error(`Unexpected column constraint ${this.tokens.current().value}`)
  }

  drop() {
    if (this.tokens.match("TABLE")) {
      return { type: "drop_table", name: this.tokens.identifier() }
    }
    this.tokens.expect("INDEX")
    return { type: "drop_index", name: this.tokens.identifier() }
  }
}
