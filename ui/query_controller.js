import { createTableSql, deleteSql, identifier, insertSql, updateSql } from "./sql_builder.js"

const DATA_LIMIT = 500

function groupMetadata(rows) {
  const map = new Map()
  for (const row of rows) {
    const [tableName, column, type, nullable, primary] = row
    if (!map.has(tableName)) {
      map.set(tableName, [])
    }
    map.get(tableName).push({ name: column, type, nullable: Boolean(nullable), primary: Boolean(primary) })
  }
  return [...map.entries()].map(([name, fields]) => ({ name, fields }))
}

function rowObject(columns, row) {
  const object = {}
  columns.forEach((name, index) => {
    object[name] = row[index]
  })
  return object
}

function sameRow(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export class QueryController {
  constructor(client, render) {
    this.client = client
    this.render = render
    this.state = {
      running: false,
      tables: [],
      selectedTable: null,
      tableData: null,
      snapshot: [],
      origIndices: [],
      deleted: new Set(),
      dirty: false,
      gridVersion: 0,
      sqlResult: null,
      sqlElapsed: 0,
      tab: "data",
      error: null,
      status: "Ready",
      scrollToRow: null,
    }
  }

  update(patch = {}) {
    this.state = { ...this.state, ...patch }
    this.render(this.state)
  }

  async loadMetadata() {
    try {
      const result = await this.client.metadata()
      this.update({ tables: groupMetadata(result.rows), error: result.error || null })
    } catch (error) {
      this.update({ error: error.message })
    }
  }

  async selectTable(name) {
    this.update({ selectedTable: name, tab: "data", error: null, dirty: false })
    await this.loadTable(name)
  }

  async loadTable(name) {
    if (!name) {
      this.update({
        tableData: null,
        snapshot: [],
        origIndices: [],
        deleted: new Set(),
        dirty: false,
        gridVersion: this.state.gridVersion + 1,
      })
      return
    }
    let result
    try {
      result = await this.client.query(`SELECT * FROM ${identifier(name)} LIMIT ${DATA_LIMIT};`)
    } catch (error) {
      this.update({
        tableData: null,
        snapshot: [],
        origIndices: [],
        deleted: new Set(),
        dirty: false,
        error: error.message,
        gridVersion: this.state.gridVersion + 1,
      })
      return
    }
    if (result.error) {
      this.update({
        tableData: null,
        snapshot: [],
        origIndices: [],
        deleted: new Set(),
        dirty: false,
        error: result.error,
        gridVersion: this.state.gridVersion + 1,
      })
      return
    }
    const rows = result.rows
    this.update({
      tableData: { columns: result.columns, rows, limited: rows.length >= DATA_LIMIT },
      snapshot: rows.map(row => [...row]),
      origIndices: rows.map((_, index) => index),
      deleted: new Set(),
      dirty: false,
      error: null,
      gridVersion: this.state.gridVersion + 1,
      status: "Ready",
    })
  }

  setCell(rowIndex, colIndex, value) {
    const { tableData } = this.state
    if (!tableData || !tableData.rows[rowIndex]) {
      return
    }
    tableData.rows[rowIndex][colIndex] = value
    this.update({ dirty: true })
  }

  newRecord() {
    const { tableData, selectedTable } = this.state
    if (!tableData || !selectedTable) {
      return
    }
    tableData.rows.push(tableData.columns.map(() => null))
    this.state.origIndices.push(-1)
    this.update({ dirty: true, gridVersion: this.state.gridVersion + 1, scrollToRow: tableData.rows.length - 1 })
  }

  deleteRows(indices) {
    const { tableData, deleted } = this.state
    if (!tableData || !indices.length) {
      return
    }
    const remove = new Set(indices)
    const keptRows = []
    const keptOrigins = []
    tableData.rows.forEach((row, index) => {
      if (remove.has(index)) {
        const origin = this.state.origIndices[index]
        if (origin >= 0) {
          deleted.add(origin)
        }
      } else {
        keptRows.push(row)
        keptOrigins.push(this.state.origIndices[index])
      }
    })
    this.update({
      tableData: { ...tableData, rows: keptRows },
      origIndices: keptOrigins,
      deleted,
      dirty: true,
      gridVersion: this.state.gridVersion + 1,
    })
  }

  async applyChanges() {
    const { tableData, snapshot, deleted, tables, selectedTable, origIndices } = this.state
    if (!tableData || !selectedTable) {
      return
    }
    const table = tables.find(item => item.name === selectedTable)
    const fieldByName = new Map((table?.fields ?? []).map(field => [field.name, field]))
    const columns = tableData.columns
    const fields = columns.map(name => fieldByName.get(name))
    const primaryKey = (table?.fields ?? []).find(field => field.primary)

    const hasMutations = deleted.size > 0 || tableData.rows.some((row, index) => {
      return origIndices[index] >= 0 && !sameRow(row, snapshot[origIndices[index]])
    })
    if (hasMutations && !primaryKey) {
      this.update({ error: "This table has no primary key. Row edits and deletes are not supported here — use Execute SQL." })
      return
    }

    const statements = []
    const buildErrors = []
    const build = (factory) => {
      try {
        statements.push(factory())
      } catch (error) {
        buildErrors.push(error.message)
      }
    }

    for (const origin of [...deleted].sort((a, b) => b - a)) {
      build(() => deleteSql(selectedTable, primaryKey, rowObject(columns, snapshot[origin])))
    }
    tableData.rows.forEach((row, index) => {
      const origin = origIndices[index]
      const values = rowObject(columns, row)
      if (origin < 0) {
        build(() => insertSql(selectedTable, fields, values))
      } else if (!sameRow(row, snapshot[origin])) {
        build(() => updateSql(selectedTable, fields, values, primaryKey, rowObject(columns, snapshot[origin])))
      }
    })

    if (buildErrors.length) {
      this.update({ error: buildErrors.join("\n") })
      return
    }

    if (!statements.length) {
      this.update({ dirty: false, status: "No changes" })
      return
    }
    this.update({ running: true, error: null })
    let transactionOpen = false
    try {
      const started = await this.client.query("BEGIN;")
      if (started.error) {
        throw new Error(started.error)
      }
      transactionOpen = true
      for (const sql of statements) {
        const result = await this.client.query(sql)
        if (result.error) {
          throw new Error(result.error)
        }
      }
      const committed = await this.client.query("COMMIT;")
      if (committed.error) {
        throw new Error(committed.error)
      }
      transactionOpen = false
      await this.loadMetadata()
      await this.loadTable(selectedTable)
      this.update({ running: false, status: `Applied ${statements.length} change${statements.length === 1 ? "" : "s"}` })
    } catch (error) {
      if (transactionOpen) {
        try {
          await this.client.query("ROLLBACK;")
        } catch {
        }
      }
      this.update({ running: false, error: error.message })
    }
  }

  async revert() {
    if (this.state.selectedTable) {
      await this.loadTable(this.state.selectedTable)
    }
  }

  async executeSql(sql) {
    if (!sql.trim() || this.state.running) {
      return
    }
    const started = performance.now()
    this.update({ running: true, sqlResult: null, error: null, tab: "sql" })
    try {
      const result = await this.client.query(sql)
      this.update({ running: false, sqlResult: result, sqlElapsed: performance.now() - started, error: result.error || null, status: "Ready" })
      if (!result.error) {
        await this.loadMetadata()
      }
    } catch (error) {
      this.update({ running: false, error: error.message, sqlElapsed: performance.now() - started })
    }
  }

  async createTable({ name, fields }) {
    try {
      const sql = createTableSql(name, fields)
      const result = await this.client.query(sql)
      if (result.error) {
        this.update({ error: result.error })
        return false
      }
      await this.loadMetadata()
      await this.selectTable(name)
      return true
    } catch (error) {
      this.update({ error: error.message })
      return false
    }
  }

  async dropTable(name) {
    try {
      const result = await this.client.query(`DROP TABLE ${identifier(name)};`)
      if (result.error) {
        this.update({ error: result.error })
        return
      }
      await this.loadMetadata()
      if (this.state.selectedTable === name) {
        this.update({
          selectedTable: null,
          tableData: null,
          snapshot: [],
          origIndices: [],
          deleted: new Set(),
          dirty: false,
          gridVersion: this.state.gridVersion + 1,
          status: `Dropped ${name}`,
        })
      } else {
        this.update({ status: `Dropped ${name}` })
      }
    } catch (error) {
      this.update({ error: error.message })
    }
  }
}
