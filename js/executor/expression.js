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

export function compileRowExpression(expression) {
  if (expression.type === "binary" && (expression.operator === "AND" || expression.operator === "OR")) {
    const left = compileRowExpression(expression.left)
    const right = compileRowExpression(expression.right)
    return expression.operator === "AND"
      ? row => sqlBoolean(left(row)) && sqlBoolean(right(row))
      : row => sqlBoolean(left(row)) || sqlBoolean(right(row))
  }
  if (expression.type === "binary") {
    const column = expression.left.type === "column" && expression.right.type === "literal"
      ? expression.left
      : expression.right.type === "column" && expression.left.type === "literal" ? expression.right : null
    const literal = expression.left.type === "literal"
      ? expression.left.value
      : expression.right.type === "literal" ? expression.right.value : undefined
    if (column && literal !== undefined) {
      const index = column.binding.index
      const operator = expression.left === column ? expression.operator : reverseOperator(expression.operator)
      if (operator === "=") {
        return row => row[index] !== null && row[index] === literal
      }
      if (operator === "!=") {
        return row => row[index] !== null && row[index] !== literal
      }
      if (operator === "<") {
        return row => row[index] !== null && row[index] < literal
      }
      if (operator === "<=") {
        return row => row[index] !== null && row[index] <= literal
      }
      if (operator === ">") {
        return row => row[index] !== null && row[index] > literal
      }
      if (operator === ">=") {
        return row => row[index] !== null && row[index] >= literal
      }
    }
  }
  return row => evaluateRow(expression, row)
}

function reverseOperator(operator) {
  if (operator === "<") {
    return ">"
  }
  if (operator === "<=") {
    return ">="
  }
  if (operator === ">") {
    return "<"
  }
  if (operator === ">=") {
    return "<="
  }
  return operator
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
