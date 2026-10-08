import { SqlError } from "../errors.js"

export function evaluate(expression, context) {
  if (expression.type === "literal") {
    return expression.value
  }
  if (expression.type === "column") {
    return context[expression.binding.table][expression.binding.index]
  }
  if (expression.type === "unary") {
    const value = evaluate(expression.operand, context)
    if (expression.operator === "NOT") {
      return !sqlBoolean(value)
    }
    if (expression.operator === "-") {
      return -value
    }
    if (expression.operator === "+") {
      return value
    }
  }
  if (expression.type === "is_null") {
    return expression.not ? evaluate(expression.operand, context) !== null : evaluate(expression.operand, context) === null
  }
  if (expression.type === "binary") {
    return binary(expression.operator, evaluate(expression.left, context), evaluate(expression.right, context))
  }
  throw new SqlError(`Cannot evaluate ${expression.type}`)
}

export function evaluateRow(expression, row) {
  if (expression.type === "literal") {
    return expression.value
  }
  if (expression.type === "column") {
    return row[expression.binding.index]
  }
  if (expression.type === "unary") {
    const value = evaluateRow(expression.operand, row)
    if (expression.operator === "NOT") {
      return !sqlBoolean(value)
    }
    if (expression.operator === "-") {
      return -value
    }
    if (expression.operator === "+") {
      return value
    }
  }
  if (expression.type === "is_null") {
    return expression.not ? evaluateRow(expression.operand, row) !== null : evaluateRow(expression.operand, row) === null
  }
  if (expression.type === "binary") {
    return binary(expression.operator, evaluateRow(expression.left, row), evaluateRow(expression.right, row))
  }
  throw new SqlError(`Cannot evaluate ${expression.type}`)
}

function binary(operator, left, right) {
  if (operator === "AND") {
    return sqlBoolean(left) && sqlBoolean(right)
  }
  if (operator === "OR") {
    return sqlBoolean(left) || sqlBoolean(right)
  }
  if (left === null || right === null) {
    return null
  }
  if (typeof left === "number" && typeof right === "bigint") {
    right = Number(right)
  }
  if (typeof left === "bigint" && typeof right === "number") {
    left = Number(left)
  }
  if (operator === "=") {
    return left === right
  }
  if (operator === "!=") {
    return left !== right
  }
  if (operator === "<") {
    return left < right
  }
  if (operator === "<=") {
    return left <= right
  }
  if (operator === ">") {
    return left > right
  }
  if (operator === ">=") {
    return left >= right
  }
  if (operator === "+") {
    return left + right
  }
  if (operator === "-") {
    return left - right
  }
  if (operator === "*") {
    return left * right
  }
  if (operator === "/") {
    return left / right
  }
  throw new SqlError(`Unknown operator ${operator}`)
}

export function sqlBoolean(value) {
  return value === true
}
