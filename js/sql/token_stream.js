import { SqlError } from "../errors.js"

export class TokenStream {
  constructor(tokens) {
    this.tokens = tokens
    this.position = 0
  }

  current() {
    return this.tokens[this.position]
  }

  previous() {
    return this.tokens[this.position - 1]
  }

  at(value) {
    return this.current().value === value
  }

  take() {
    return this.tokens[this.position++]
  }

  match(value) {
    if (!this.at(value)) {
      return false
    }
    this.position += 1
    return true
  }

  expect(value) {
    if (!this.match(value)) {
      throw this.error(`Expected ${value}, received ${this.current().value}`)
    }
    return this.previous()
  }

  identifier() {
    const token = this.current()
    if (token.type !== "identifier") {
      throw this.error(`Expected identifier, received ${token.value}`)
    }
    this.position += 1
    return token.value
  }

  list(parse) {
    const values = [parse()]
    while (this.match(",")) {
      values[values.length] = parse()
    }
    return values
  }

  error(message) {
    return new SqlError(message, this.current().position)
  }
}
