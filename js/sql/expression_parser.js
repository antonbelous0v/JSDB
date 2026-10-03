const PRECEDENCE = { "OR": 1, "AND": 2, "=": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, "+": 4, "-": 4, "*": 5, "/": 5 }
const FUNCTIONS = new Set(["COUNT", "SUM", "MIN", "MAX", "AVG"])

export class ExpressionParser {
  constructor(tokens) {
    this.tokens = tokens
  }

  parse(precedence = 0) {
    let left = this.primary()
    while (true) {
      if (this.tokens.match("IS")) {
        const not = this.tokens.match("NOT")
        this.tokens.expect("NULL")
        left = { type: "is_null", operand: left, not }
        continue
      }
      const operator = this.tokens.current().value
      const next = PRECEDENCE[operator]
      if (!next || next <= precedence) {
        return left
      }
      this.tokens.take()
      left = { type: "binary", operator, left, right: this.parse(next) }
    }
  }

  primary() {
    if (this.tokens.match("NOT") || this.tokens.match("-") || this.tokens.match("+")) {
      return { type: "unary", operator: this.tokens.previous().value, operand: this.parse(6) }
    }
    if (this.tokens.match("(")) {
      const expression = this.parse()
      this.tokens.expect(")")
      return expression
    }
    if (this.tokens.match("NULL")) {
      return { type: "literal", value: null }
    }
    if (this.tokens.current().type === "literal") {
      return { type: "literal", value: this.tokens.take().value }
    }
    if (this.tokens.match("*")) {
      return { type: "star" }
    }
    return this.reference()
  }

  reference() {
    const current = this.tokens.current()
    const name = FUNCTIONS.has(current.value) ? this.tokens.take().value : this.tokens.identifier()
    if (this.tokens.match("(")) {
      const args = this.tokens.match("*") ? [{ type: "star" }] : this.tokens.list(() => this.parse())
      this.tokens.expect(")")
      return { type: "call", name: name.toUpperCase(), args }
    }
    if (this.tokens.match(".")) {
      return { type: "column", table: name, name: this.tokens.identifier() }
    }
    return { type: "column", table: null, name }
  }
}
