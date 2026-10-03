export class MutationParser {
  constructor(tokens, expressions) {
    this.tokens = tokens
    this.expressions = expressions
  }

  insert() {
    this.tokens.expect("INTO")
    const table = this.tokens.identifier()
    let columns = null
    if (this.tokens.match("(")) {
      columns = this.tokens.list(() => this.tokens.identifier())
      this.tokens.expect(")")
    }
    this.tokens.expect("VALUES")
    const values = []
    do {
      this.tokens.expect("(")
      values[values.length] = this.tokens.list(() => this.expressions.parse())
      this.tokens.expect(")")
    } while (this.tokens.match(","))
    return { type: "insert", table, columns, values }
  }

  update() {
    const table = this.tokens.identifier()
    this.tokens.expect("SET")
    const assignments = []
    do {
      const column = this.tokens.identifier()
      this.tokens.expect("=")
      assignments[assignments.length] = { column, value: this.expressions.parse() }
    } while (this.tokens.match(","))
    const where = this.tokens.match("WHERE") ? this.expressions.parse() : null
    return { type: "update", table, assignments, where }
  }

  delete() {
    this.tokens.expect("FROM")
    const table = this.tokens.identifier()
    const where = this.tokens.match("WHERE") ? this.expressions.parse() : null
    return { type: "delete", table, where }
  }
}
