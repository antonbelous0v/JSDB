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
      return { kind: "Project", input: this.plan(logical.input), columns: logical.columns }
    }
    if (logical.kind === "aggregate") {
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
    const column = condition.left.type === "column" && condition.right.type === "literal" ? condition.left : condition.right.type === "column" && condition.left.type === "literal" ? condition.right : null
    const literal = condition.left.type === "literal" ? condition.left : condition.right.type === "literal" ? condition.right : null
    if (!column || !literal || column.binding.table !== input.reference.alias) {
      return null
    }
    const index = input.reference.metadata.indexes.find(candidate => candidate.columns.length === 1 && candidate.columns[0] === column.name) ?? (input.reference.metadata.schema.primaryKey.length === 1 && input.reference.metadata.schema.primaryKey[0] === column.name ? { name: `${input.reference.name}_pkey` } : null)
    return index ? { kind: "IndexScan", reference: input.reference, index: index.name, key: literal.value } : null
  }

  limit(input, limit) {
    if (input.kind === "Project" && input.input.kind === "Filter" && input.input.input.kind === "SeqScan") {
      return { kind: "LimitedSeqScanProject", reference: input.input.input.reference, condition: input.input.condition, columns: input.columns, limit }
    }
    return { kind: "Limit", input, limit }
  }
}
