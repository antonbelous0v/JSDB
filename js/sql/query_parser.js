export class QueryParser {
  constructor(tokens, expressions) {
    this.tokens = tokens
    this.expressions = expressions
  }

  select() {
    const columns = this.tokens.list(() => this.selectItem())
    this.tokens.expect("FROM")
    const from = this.tableReference()
    const joins = []
    while (this.tokens.match("INNER")) {
      this.tokens.expect("JOIN")
      const table = this.tableReference()
      this.tokens.expect("ON")
      joins[joins.length] = { table, on: this.expressions.parse() }
    }
    const where = this.tokens.match("WHERE") ? this.expressions.parse() : null
    const orderBy = this.orderBy()
    const limit = this.tokens.match("LIMIT") ? this.expressions.parse() : null
    return { type: "select", columns, from, joins, where, orderBy, limit }
  }

  selectItem() {
    const expression = this.expressions.parse()
    const alias = this.tokens.match("AS") ? this.tokens.identifier() : null
    return { expression, alias }
  }

  tableReference() {
    const name = this.tokens.identifier()
    const alias = this.tokens.match("AS") ? this.tokens.identifier() : this.tokens.current().type === "identifier" ? this.tokens.identifier() : null
    return { name, alias }
  }

  orderBy() {
    if (!this.tokens.match("ORDER")) {
      return []
    }
    this.tokens.expect("BY")
    return this.tokens.list(() => {
      const expression = this.expressions.parse()
      const direction = this.tokens.match("DESC") ? "DESC" : "ASC"
      if (direction === "ASC") {
        this.tokens.match("ASC")
      }
      return { expression, direction }
    })
  }
}
