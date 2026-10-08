import { Lexer } from "./lexer.js"
import { TokenStream } from "./token_stream.js"
import { ExpressionParser } from "./expression_parser.js"
import { DdlParser } from "./ddl_parser.js"
import { MutationParser } from "./mutation_parser.js"
import { QueryParser } from "./query_parser.js"

export class Parser {
  constructor(sql) {
    this.tokens = new TokenStream(new Lexer(sql).tokenize())
    this.expressions = new ExpressionParser(this.tokens)
    this.ddl = new DdlParser(this.tokens)
    this.mutations = new MutationParser(this.tokens, this.expressions)
    this.queries = new QueryParser(this.tokens, this.expressions)
  }

  parse() {
    const statements = []
    while (!this.tokens.at("EOF")) {
      statements[statements.length] = this.statement()
      if (!this.tokens.match(";") && !this.tokens.at("EOF")) {
        throw this.tokens.error(`Expected statement terminator, received ${this.tokens.current().value}`)
      }
    }
    return statements
  }

  statement() {
    const type = this.tokens.take().value
    switch (type) {
      case "CREATE":
        return this.ddl.create()
      case "DROP":
        return this.ddl.drop()
      case "INSERT":
        return this.mutations.insert()
      case "UPDATE":
        return this.mutations.update()
      case "DELETE":
        return this.mutations.delete()
      case "SELECT":
        return this.queries.select()
      case "BEGIN":
        if (this.tokens.match("READ")) {
          this.tokens.expect("ONLY")
          return { type: "begin", readOnly: true }
        }
        return { type: "begin", readOnly: false }
      case "COMMIT":
        return { type: "commit" }
      case "ROLLBACK":
        return { type: "rollback" }
      case "EXPLAIN":
        return { type: "explain", analyze: this.tokens.match("ANALYZE"), statement: this.statement() }
      case "VACUUM":
        return { type: "vacuum", table: this.tokens.identifier() }
      default:
        throw this.tokens.error(`Unexpected token ${type}`)
    }
  }
}
