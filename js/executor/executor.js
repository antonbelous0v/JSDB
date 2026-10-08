import { aggregate } from "./aggregate.js"
import { evaluate } from "./expression.js"
import { filter, limit, nestedLoopJoin, project, sort } from "./operators.js"
import { indexScan, indexScanProject, limitedSequenceScan, scanAggregate, scanProject, sequenceScan } from "./scans.js"

export class Executor {
  constructor(resolveTable, transaction) {
    this.resolveTable = resolveTable
    this.transaction = transaction
  }

  execute(plan, observer = null) {
    const start = observer ? performance.now() : 0
    const rows = this.executePlan(plan, observer)
    if (observer) {
      observer(plan, rows.length, performance.now() - start)
    }
    return rows
  }

  executePlan(plan, observer) {
    if (plan.kind === "SeqScan") {
      return sequenceScan(this.resolveTable(plan.reference.name), plan.reference, this.transaction)
    }
    if (plan.kind === "IndexScan") {
      return indexScan(this.resolveTable(plan.reference.name), plan.reference, plan.index, plan.key, this.transaction)
    }
    if (plan.kind === "IndexScanProject") {
      return indexScanProject(this.resolveTable(plan.reference.name), plan.index, plan.key, this.transaction, plan.columns)
    }
    if (plan.kind === "Filter") {
      return filter(this.execute(plan.input, observer), plan.condition)
    }
    if (plan.kind === "Project") {
      return project(this.execute(plan.input, observer), plan.columns)
    }
    if (plan.kind === "Aggregate") {
      return aggregate(this.execute(plan.input, observer), plan.columns)
    }
    if (plan.kind === "NestedLoopJoin") {
      return nestedLoopJoin(this.execute(plan.left, observer), () => this.execute(plan.right, observer), plan.condition)
    }
    if (plan.kind === "Sort") {
      return sort(this.execute(plan.input, observer), plan.orderBy)
    }
    if (plan.kind === "Limit") {
      const count = Number(evaluate(plan.limit, {}))
      return limit(this.execute(plan.input, observer), count)
    }
    if (plan.kind === "LimitedSeqScanProject") {
      const count = Number(evaluate(plan.limit, {}))
      const rows = limitedSequenceScan(this.resolveTable(plan.reference.name), plan.reference, this.transaction, plan.condition, count)
      return project(rows, plan.columns)
    }
    if (plan.kind === "SeqScanProject") {
      const count = plan.limit ? Number(evaluate(plan.limit, {})) : Infinity
      return scanProject(this.resolveTable(plan.reference.name), this.transaction, plan.columns, plan.condition, count)
    }
    if (plan.kind === "SeqScanAggregate") {
      return scanAggregate(this.resolveTable(plan.reference.name), this.transaction, plan.columns, plan.condition)
    }
    throw new Error(`Unknown physical operator ${plan.kind}`)
  }
}
