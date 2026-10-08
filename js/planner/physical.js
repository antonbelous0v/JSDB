export class PhysicalPlanner {
  plan(logical) {
    if (logical.kind === "scan") {
      return this.scan(logical.reference)
    }
    if (logical.kind === "filter") {
      const indexed = this.indexCondition(logical.condition, logical.input)
      if (indexed) {
        return indexed
      }
      return { kind: "Filter", input: this.plan(logical.input), condition: logical.condition }
    }
    if (logical.kind === "join") {
      return { kind: "NestedLoopJoin", left: this.plan(logical.left), right: this.plan(logical.right), condition: logical.condition }
    }
    if (logical.kind === "project") {
      if (logical.input.kind === "scan") {
        return { kind: "SeqScanProject", reference: logical.input.reference, columns: logical.columns }
      }
      if (logical.input.kind === "filter" && logical.input.input.kind === "scan") {
        const indexed = this.indexCondition(logical.input.condition, logical.input.input)
        if (indexed) {
          return { ...indexed, kind: "IndexScanProject", columns: logical.columns }
        }
        return { kind: "SeqScanProject", reference: logical.input.input.reference, condition: logical.input.condition, columns: logical.columns }
      }
      return { kind: "Project", input: this.plan(logical.input), columns: logical.columns }
    }
    if (logical.kind === "aggregate") {
      if (logical.input.kind === "scan") {
        return { kind: "SeqScanAggregate", reference: logical.input.reference, columns: logical.columns }
      }
      if (logical.input.kind === "filter" && logical.input.input.kind === "scan" && !this.indexCondition(logical.input.condition, logical.input.input)) {
        return { kind: "SeqScanAggregate", reference: logical.input.input.reference, condition: logical.input.condition, columns: logical.columns }
      }
      return { kind: "Aggregate", input: this.plan(logical.input), columns: logical.columns }
    }
    if (logical.kind === "sort") {
      return { kind: "Sort", input: this.plan(logical.input), orderBy: logical.orderBy }
    }
    if (logical.kind === "limit") {
      return this.limit(this.plan(logical.input), logical.limit)
    }
    return logical
  }

  scan(reference) {
    return { kind: "SeqScan", reference }
  }

  indexCondition(condition, input) {
    if (input.kind !== "scan" || condition.type !== "binary" || condition.operator !== "=") {
      return null
    }
    const rightValue = condition.right.type === "literal" || condition.right.type === "parameter"
    const leftValue = condition.left.type === "literal" || condition.left.type === "parameter"
    const column = condition.left.type === "column" && rightValue ? condition.left : condition.right.type === "column" && leftValue ? condition.right : null
    const literal = leftValue ? condition.left : rightValue ? condition.right : null
    if (!column || !literal || column.binding.table !== input.reference.alias) {
      return null
    }
    const index = input.reference.metadata.indexes.find(candidate => candidate.columns.length === 1 && candidate.columns[0] === column.name) ?? (input.reference.metadata.schema.primaryKey.length === 1 && input.reference.metadata.schema.primaryKey[0] === column.name ? { name: `${input.reference.name}_pkey` } : null)
    return index ? { kind: "IndexScan", reference: input.reference, index: index.name, key: literal.value } : null
  }

  limit(input, limit) {
    if (input.kind === "SeqScanProject") {
      return { ...input, limit }
    }
    if (input.kind === "Project" && input.input.kind === "Filter" && input.input.input.kind === "SeqScan") {
      return { kind: "LimitedSeqScanProject", reference: input.input.input.reference, condition: input.input.condition, columns: input.columns, limit }
    }
    return { kind: "Limit", input, limit }
  }
}
