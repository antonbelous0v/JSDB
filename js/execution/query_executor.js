import { Binder } from "../sql/binder.js"
import { LogicalPlanner } from "../planner/logical.js"
import { PhysicalPlanner } from "../planner/physical.js"
import { Executor } from "../executor/executor.js"
import { explain, explainAnalyze } from "../planner/explain.js"

export class QueryExecutor {
  constructor(catalog, tables) {
    this.catalog = catalog
    this.tables = tables
  }

  plan(statement) {
    const bound = statement.references ? statement : new Binder(this.catalog).bind(statement)
    return new PhysicalPlanner().plan(new LogicalPlanner().plan(bound))
  }

  select(statement, transaction) {
    return new Executor(name => this.tables.table(name), transaction).execute(this.plan(statement))
  }

  explain(statement, transaction, analyze = false) {
    const plan = this.plan(statement)
    if (!analyze) {
      return explain(plan)
    }
    const metrics = new WeakMap()
    const executor = new Executor(name => this.tables.table(name), transaction)
    executor.execute(plan, (operator, rows, milliseconds) => {
      const current = metrics.get(operator)
      metrics.set(operator, current
        ? { rows: current.rows + rows, milliseconds: current.milliseconds + milliseconds }
        : { rows, milliseconds })
    })
    return explainAnalyze(plan, metrics)
  }
}
