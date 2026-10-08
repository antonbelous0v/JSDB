import { SqlError } from "../errors.js"

const KEYWORDS = new Set("CREATE TABLE DROP INDEX UNIQUE INSERT INTO VALUES UPDATE SET DELETE FROM SELECT WHERE ORDER BY ASC DESC LIMIT BEGIN COMMIT ROLLBACK EXPLAIN INNER JOIN ON AS AND OR NOT IS NULL PRIMARY KEY REFERENCES BOOLEAN INT INTEGER BIGINT FLOAT REAL TEXT TIMESTAMP COUNT SUM MIN MAX AVG GROUP".split(" "))

export class Lexer {
  constructor(sql) {
    this.sql = sql
    this.position = 0
  }

  tokenize() {
    const tokens = new Array(this.sql.length + 1)
    let count = 0
    while (this.position < this.sql.length) {
      const start = this.position
      const char = this.sql[this.position]
      const code = this.sql.charCodeAt(this.position)
      if (isSpace(code) || code > 127 && /\s/u.test(char)) {
        this.position += 1
        continue
      }
      if (char === "'" || char === "\"") {
        tokens[count++] = this.string(char, start)
        continue
      }
      if (isLetter(code) || code === 95) {
        tokens[count++] = this.word(start)
        continue
      }
      if (isDigit(code)) {
        tokens[count++] = this.number(start)
        continue
      }
      const pair = this.sql.slice(this.position, this.position + 2)
      if (pair === "<=" || pair === ">=" || pair === "!=" || pair === "<>") {
        this.position += 2
        tokens[count++] = { type: "operator", value: pair === "<>" ? "!=" : pair, position: start }
        continue
      }
      if ("(),;.*+-/=<>".includes(char)) {
        this.position += 1
        tokens[count++] = { type: "symbol", value: char, position: start }
        continue
      }
      throw new SqlError(`Unexpected character ${char}`, start)
    }
    tokens[count++] = { type: "eof", value: "EOF", position: this.position }
    tokens.length = count
    return tokens
  }

  word(start) {
    while (this.position < this.sql.length && isWord(this.sql.charCodeAt(this.position))) {
      this.position += 1
    }
    const raw = this.sql.slice(start, this.position)
    const upper = raw.toUpperCase()
    if (upper === "TRUE" || upper === "FALSE") {
      return { type: "literal", value: upper === "TRUE", position: start }
    }
    const keyword = KEYWORDS.has(upper)
    return { type: keyword ? "keyword" : "identifier", value: keyword ? upper : raw, position: start }
  }

  number(start) {
    while (this.position < this.sql.length && isDigit(this.sql.charCodeAt(this.position))) {
      this.position += 1
    }
    if (this.position < this.sql.length && this.sql[this.position] === ".") {
      this.position += 1
      while (this.position < this.sql.length && isDigit(this.sql.charCodeAt(this.position))) {
        this.position += 1
      }
    }
    const raw = this.sql.slice(start, this.position)
    const value = raw.includes(".") ? Number(raw) : BigInt(raw)
    return { type: "literal", value, position: start }
  }

  string(quote, start) {
    this.position += 1
    let value = ""
    while (this.position < this.sql.length) {
      const char = this.sql[this.position++]
      if (char === quote) {
        if (this.position < this.sql.length && this.sql[this.position] === quote) {
          value += quote
          this.position += 1
          continue
        }
        return { type: quote === "\"" ? "identifier" : "literal", value, position: start }
      }
      value += char
    }
    throw new SqlError("Unterminated string", start)
  }
}

function isDigit(code) {
  return code >= 48 && code <= 57
}
function isLetter(code) {
  return code >= 65 && code <= 90 || code >= 97 && code <= 122
}
function isWord(code) {
  return isLetter(code) || isDigit(code) || code === 95
}
function isSpace(code) {
  return code === 32 || code >= 9 && code <= 13
}
