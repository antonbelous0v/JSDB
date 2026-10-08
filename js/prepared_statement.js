import { Binder } from "./sql/binder.js"
import { Parser } from "./sql/parser.js"
import { ValidationError } from "./errors.js"

export class PreparedStatement {
  constructor(database, sql) {
    const statements = new Parser(sql).parse()
    if (statements.length !== 1 || !["select", "insert", "update", "delete", "explain"].includes(statements[0].type)) {
      throw new ValidationError("Prepared statements require one query or mutation")
    }
    this.database = database
    this.source = statements[0]
    this.parameters = collectParameters(this.source)
    this.revision = -1
    this.statement = null
  }

  execute(values = [], session = this.database.session) {
    if (!Array.isArray(values) || values.length !== this.parameters.length) {
      throw new ValidationError(`Expected ${this.parameters.length} parameters, received ${Array.isArray(values) ? values.length : 0}`)
    }
    for (let index = 0; index < values.length; index += 1) {
      this.parameters[index].value = values[index]
    }
    if (this.revision !== this.database.catalog.revision) {
      this.statement = new Binder(this.database.catalog).bind(this.source)
      this.revision = this.database.catalog.revision
    }
    return this.database.executeStatement(this.statement, true, session)
  }
}

function collectParameters(value) {
  const parameters = []
  visit(value, parameters)
  parameters.sort((left, right) => left.index - right.index)
  return parameters
}

function visit(value, parameters) {
  if (!value || typeof value !== "object") {
    return
  }
  if (value.type === "parameter") {
    parameters[parameters.length] = value
    return
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      visit(value[index], parameters)
    }
    return
  }
  for (const key of Object.keys(value)) {
    visit(value[key], parameters)
  }
}
