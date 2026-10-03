const TYPE_OPTIONS = [
  ["TEXT", "Text"],
  ["INT", "Integer (32-bit)"],
  ["BIGINT", "Integer (64-bit)"],
  ["FLOAT", "Float (64-bit)"],
  ["BOOLEAN", "Boolean"],
  ["TIMESTAMP", "Timestamp"],
]

function element(tag, className, text) {
  const node = document.createElement(tag)
  if (className) {
    node.className = className
  }
  if (text !== undefined) {
    node.textContent = text
  }
  return node
}

function valueCell(value, type) {
  const span = document.createElement("span")
  if (value === null || value === undefined) {
    span.className = "null-value"
    span.textContent = "NULL"
  } else if (type === "BOOLEAN") {
    span.textContent = value ? "true" : "false"
  } else {
    span.textContent = String(value)
  }
  return span
}

function badge(text, kind) {
  const span = document.createElement("span")
  span.className = `badge ${kind}`
  span.textContent = text
  return span
}

function readEditorValue(editor, type) {
  const raw = editor.value
  if (type === "BOOLEAN") {
    if (raw === "TRUE") {
      return true
    }
    if (raw === "FALSE") {
      return false
    }
    return null
  }
  if (raw === "") {
    return type === "TEXT" ? "" : null
  }
  return raw
}

function makeEditor(value, type) {
  if (type === "BOOLEAN") {
    const select = document.createElement("select")
    for (const [label, optionValue] of [["TRUE", "TRUE"], ["FALSE", "FALSE"], ["NULL", "NULL"]]) {
      const option = document.createElement("option")
      option.value = optionValue
      option.textContent = label
      select.append(option)
    }
    if (value === true) {
      select.value = "TRUE"
    } else if (value === false) {
      select.value = "FALSE"
    } else {
      select.value = "NULL"
    }
    return select
  }
  const input = document.createElement("input")
  input.type = "text"
  input.value = value === null || value === undefined ? "" : String(value)
  return input
}

export function createView(callbacks) {
  const ids = [
    "status",
    "schema",
    "new-table",
    "tab-data",
    "tab-sql",
    "panel-data",
    "panel-sql",
    "data-table-name",
    "data-rows",
    "new-record",
    "delete-record",
    "revert",
    "apply",
    "data-grid",
    "execute",
    "editor",
    "sql-result",
    "modal-root",
  ]
  const el = {}
  for (const id of ids) {
    el[id] = document.getElementById(id)
  }

  let currentState = null
  let lastTables = null
  let lastSelectedTable = null
  let lastGridKey = null
  let lastSqlResult = null
  const selected = new Set()

  function beginEdit(td, rowIndex, colIndex, field) {
    if (!currentState?.tableData || td.querySelector("input, select")) {
      return
    }
    const value = currentState.tableData.rows[rowIndex][colIndex]
    const editor = makeEditor(value, field?.type)
    td.replaceChildren(editor)
    let finished = false
    const commit = () => {
      if (finished) {
        return
      }
      finished = true
      const next = readEditorValue(editor, field?.type)
      callbacks.onCellEdit(rowIndex, colIndex, next)
      td.replaceChildren(valueCell(next, field?.type))
    }
    const cancel = () => {
      if (finished) {
        return
      }
      finished = true
      td.replaceChildren(valueCell(value, field?.type))
    }
    editor.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault()
        commit()
      } else if (event.key === "Escape") {
        event.preventDefault()
        cancel()
      }
    })
    editor.addEventListener("blur", commit)
    editor.addEventListener("change", commit)
    editor.focus()
    if (typeof editor.select === "function") {
      editor.select()
    }
  }

  function renderSidebar(state) {
    el.schema.replaceChildren()
    if (!state.tables.length) {
      el.schema.append(element("div", "sidebar-empty", "No tables yet. Create one with the ＋ button."))
      return
    }
    for (const table of state.tables) {
      const block = element("div", "table" + (state.selectedTable === table.name ? " selected" : ""))
      const head = element("div", "table-head")
      const name = element("button", "table-name-btn", table.name)
      name.addEventListener("click", () => callbacks.onSelectTable(table.name))
      const drop = element("button", "icon-btn drop", "×")
      drop.title = "Drop table"
      drop.addEventListener("click", (event) => {
        event.stopPropagation()
        openConfirmDrop(table.name)
      })
      head.append(name, drop)
      block.append(head)
      const fields = element("ul", "fields")
      for (const field of table.fields) {
        const li = element("li")
        li.append(element("span", "field-name", field.name))
        li.append(element("span", "field-type", field.type))
        if (field.primary) {
          li.append(badge("PK", "pk"))
        }
        if (!field.nullable) {
          li.append(badge("NOT NULL", "nn"))
        }
        fields.append(li)
      }
      block.append(fields)
      el.schema.append(block)
    }
  }

  function renderDataToolbar(state) {
    el["data-table-name"].textContent = state.selectedTable ?? "No table selected"
    const count = state.tableData?.rows.length
    const limited = state.tableData?.limited
    el["data-rows"].textContent = count == null ? "" : `${count} row${count === 1 ? "" : "s"}${limited ? " · showing first 500" : ""}`
    el["new-record"].disabled = !state.tableData || state.running
    el["delete-record"].disabled = !state.tableData || selected.size === 0 || state.running
    el.apply.disabled = !state.dirty || state.running
    el.revert.disabled = !state.dirty || state.running
  }

  function renderGrid(state) {
    el["data-grid"].replaceChildren()
    if (!state.selectedTable) {
      el["data-grid"].append(element("div", "grid-empty", "Select a table on the left to browse its data."))
      return
    }
    if (!state.tableData) {
      el["data-grid"].append(element("div", "grid-empty", state.error ? `Could not load data: ${state.error}` : "Loading…"))
      return
    }
    const data = state.tableData
    const table = state.tables.find(item => item.name === state.selectedTable)
    const fieldByName = new Map((table?.fields ?? []).map(field => [field.name, field]))

    const grid = element("table", "data-grid")
    const thead = document.createElement("thead")
    const headRow = document.createElement("tr")
    headRow.append(element("th", "rownum", "#"))
    for (const column of data.columns) {
      const th = document.createElement("th")
      th.title = fieldByName.get(column)?.type ?? ""
      th.append(element("span", "col-name", column))
      const field = fieldByName.get(column)
      if (field?.primary) {
        th.append(badge("PK", "pk"))
      }
      if (field && !field.nullable) {
        th.append(badge("NN", "nn"))
      }
      headRow.append(th)
    }
    thead.append(headRow)
    grid.append(thead)

    const tbody = document.createElement("tbody")
    data.rows.forEach((row, rowIndex) => {
      const tr = document.createElement("tr")
      if (selected.has(rowIndex)) {
        tr.classList.add("selected")
      }
      const numCell = element("td", "rownum", String(rowIndex + 1))
      numCell.addEventListener("click", () => {
        if (selected.has(rowIndex)) {
          selected.delete(rowIndex)
        } else {
          selected.add(rowIndex)
        }
        tr.classList.toggle("selected", selected.has(rowIndex))
        renderDataToolbar(currentState)
      })
      tr.append(numCell)
      row.forEach((value, colIndex) => {
        const field = fieldByName.get(data.columns[colIndex])
        const td = document.createElement("td")
        td.append(valueCell(value, field?.type))
        td.addEventListener("click", () => beginEdit(td, rowIndex, colIndex, field))
        tr.append(td)
      })
      tbody.append(tr)
    })
    grid.append(tbody)
    el["data-grid"].append(grid)

    if (state.scrollToRow != null && state.scrollToRow >= 0 && state.scrollToRow < tbody.children.length) {
      const target = tbody.children[state.scrollToRow]
      target.scrollIntoView({ block: "nearest" })
      const firstDataCell = target.children[1]
      if (firstDataCell) {
        beginEdit(firstDataCell, state.scrollToRow, 0, fieldByName.get(data.columns[0]))
      }
      state.scrollToRow = null
    }
  }

  function renderSqlResult(state) {
    el["sql-result"].replaceChildren()
    const result = state.sqlResult
    if (!result) {
      return
    }
    if (result.error) {
      el["sql-result"].append(element("pre", "error", result.error))
      return
    }
    if (result.columns.length) {
      const table = element("table", "data-grid read-only")
      const head = document.createElement("thead")
      const headRow = document.createElement("tr")
      headRow.append(element("th", "rownum", "#"))
      for (const column of result.columns) {
        headRow.append(element("th", "", column))
      }
      head.append(headRow)
      table.append(head)
      const body = document.createElement("tbody")
      result.rows.forEach((row, index) => {
        const tr = document.createElement("tr")
        tr.append(element("td", "rownum", String(index + 1)))
        for (const value of row) {
          const td = document.createElement("td")
          td.append(valueCell(value, null))
          tr.append(td)
        }
        body.append(tr)
      })
      table.append(body)
      el["sql-result"].append(table)
    }
    const meta = []
    if (result.commands.length) {
      meta.push(result.commands.join(" · "))
    }
    meta.push(`${state.sqlElapsed.toFixed(1)} ms`)
    if (result.columns.length) {
      meta.push(`${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`)
    }
    el["sql-result"].append(element("p", "command", meta.join(" · ")))
  }

  function openCreateTableModal() {
    const root = el["modal-root"]
    root.replaceChildren()
    const backdrop = element("div", "modal-backdrop")
    const modal = element("div", "modal")
    modal.append(element("h2", "modal-title", "New table"))

    modal.append(element("label", "form-label", "Table name"))
    const nameInput = element("input", "form-input")
    nameInput.placeholder = "table_name"
    modal.append(nameInput)

    modal.append(element("label", "form-label", "Fields"))
    const fieldsBox = element("div", "fields-editor")
    const readers = []
    const addFieldRow = (definition = {}) => {
      const row = element("div", "field-row")
      const name = element("input", "field-name-input")
      name.placeholder = "column_name"
      name.value = definition.name ?? ""
      const type = document.createElement("select")
      for (const [optionValue, label] of TYPE_OPTIONS) {
        const option = document.createElement("option")
        option.value = optionValue
        option.textContent = label
        type.append(option)
      }
      type.value = definition.type ?? "TEXT"
      const pkLabel = element("label", "chk")
      const pkBox = document.createElement("input")
      pkBox.type = "checkbox"
      pkBox.checked = Boolean(definition.primary)
      pkLabel.append(pkBox, " PK")
      const nnLabel = element("label", "chk")
      const nnBox = document.createElement("input")
      nnBox.type = "checkbox"
      nnBox.checked = definition.nullable === false
      nnLabel.append(nnBox, " NOT NULL")
      const remove = element("button", "icon-btn", "×")
      remove.title = "Remove field"
      remove.type = "button"
      remove.addEventListener("click", () => row.remove())
      pkBox.addEventListener("change", () => {
        if (pkBox.checked) {
          nnBox.checked = true
        }
      })
      row.append(name, type, pkLabel, nnLabel, remove)
      fieldsBox.append(row)
      readers[readers.length] = () => row.isConnected ? { name: name.value, type: type.value, primary: pkBox.checked, nullable: !nnBox.checked } : null
    }

    addFieldRow({ primary: true, nullable: false })

    const addButton = element("button", "btn ghost add-field", "+ Add field")
    addButton.type = "button"
    addButton.addEventListener("click", () => addFieldRow())
    modal.append(fieldsBox, addButton)

    const actions = element("div", "modal-actions")
    const error = element("span", "form-error")
    const cancel = element("button", "btn ghost", "Cancel")
    cancel.type = "button"
    cancel.addEventListener("click", () => root.replaceChildren())
    const create = element("button", "btn primary", "Create")
    create.type = "button"
    create.addEventListener("click", async () => {
      const fields = []
      for (const read of readers) {
        const field = read()
        if (field) {
          fields[fields.length] = field
        }
      }
      const ok = await callbacks.onCreateTable({ name: nameInput.value, fields })
      if (ok) {
        root.replaceChildren()
      } else {
        error.textContent = currentState.error ?? "Failed to create table"
      }
    })
    actions.append(error, cancel, create)
    modal.append(actions)
    backdrop.append(modal)
    root.append(backdrop)
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        root.replaceChildren()
      }
    })
    nameInput.focus()
  }

  function openConfirmDrop(name) {
    const root = el["modal-root"]
    root.replaceChildren()
    const backdrop = element("div", "modal-backdrop")
    const modal = element("div", "modal narrow")
    modal.append(element("h2", "modal-title", "Drop table"))
    modal.append(element("p", "confirm-text", `Drop table "${name}"? This cannot be undone.`))
    const actions = element("div", "modal-actions")
    const cancel = element("button", "btn ghost", "Cancel")
    cancel.type = "button"
    cancel.addEventListener("click", () => root.replaceChildren())
    const drop = element("button", "btn danger", "Drop")
    drop.type = "button"
    drop.addEventListener("click", () => {
      root.replaceChildren()
      callbacks.onDropTable(name)
    })
    actions.append(cancel, drop)
    modal.append(actions)
    backdrop.append(modal)
    root.append(backdrop)
  }

  function render(state) {
    currentState = state
    el.status.textContent = state.running ? "Running…" : (state.error ?? state.status ?? "Ready")
    el.status.classList.toggle("error", Boolean(state.error) && !state.running)

    if (state.tables !== lastTables || state.selectedTable !== lastSelectedTable) {
      lastTables = state.tables
      lastSelectedTable = state.selectedTable
      renderSidebar(state)
    }

    el["tab-data"].classList.toggle("active", state.tab === "data")
    el["tab-sql"].classList.toggle("active", state.tab === "sql")
    el["panel-data"].classList.toggle("active", state.tab === "data")
    el["panel-sql"].classList.toggle("active", state.tab === "sql")

    renderDataToolbar(state)

    const gridKey = `${state.selectedTable ?? ""}:${state.gridVersion}`
    if (gridKey !== lastGridKey) {
      lastGridKey = gridKey
      selected.clear()
      renderGrid(state)
    }

    if (state.sqlResult !== lastSqlResult) {
      lastSqlResult = state.sqlResult
      renderSqlResult(state)
    }
  }

  el["new-table"].addEventListener("click", openCreateTableModal)
  el["tab-data"].addEventListener("click", () => callbacks.onSwitchTab("data"))
  el["tab-sql"].addEventListener("click", () => callbacks.onSwitchTab("sql"))
  el["new-record"].addEventListener("click", () => callbacks.onNewRecord())
  el["delete-record"].addEventListener("click", () => callbacks.onDeleteRows([...selected]))
  el.revert.addEventListener("click", () => callbacks.onRevert())
  el.apply.addEventListener("click", () => callbacks.onApply())
  el.execute.addEventListener("click", () => callbacks.onExecuteSql(el.editor.value))
  el.editor.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault()
      callbacks.onExecuteSql(el.editor.value)
    }
  })

  return { render }
}
