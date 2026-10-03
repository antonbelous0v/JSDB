import { SqlError } from "../errors.js"

export class ExpressionBinder {
  bind(expression, references) {
    switch (expression.type) {
      case "column":
        this.bindColumn(expression, references)
        return
      case "binary":
        this.bind(expression.left, references)
        this.bind(expression.right, references)
        return
      case "unary":
      case "is_null":
        this.bind(expression.operand, references)
        return
      case "call":
        for (const argument of expression.args) {
          if (argument.type !== "star") {
            this.bind(argument, references)
          }
        }
    }
  }

  bindColumn(expression, references) {
    let match = null
    let matches = 0
    for (const reference of references) {
      if (expression.table && reference.alias !== expression.table && reference.name !== expression.table) {
        continue
      }
      if (reference.schema.columns.some(column => column.name === expression.name)) {
        match = reference
        matches += 1
      }
    }
    if (matches !== 1) {
      throw new SqlError(matches ? `Ambiguous column ${expression.name}` : `Unknown column ${expression.name}`)
    }
    expression.binding = { table: match.alias, index: match.schema.indexOf(expression.name) }
  }
}
