import assert from "node:assert/strict"
import test from "node:test"

import { createTableSql, deleteSql, insertSql, updateSql } from "../ui/sql_builder.js"

test("UI SQL builder quotes identifiers and values", () => {
  const fields = [{ name: "id", type: "BIGINT", primary: true, nullable: false }, { name: "display name", type: "TEXT", primary: false, nullable: false }]
  assert.equal(createTableSql("user data", fields), "CREATE TABLE \"user data\" (\"id\" BIGINT PRIMARY KEY, \"display name\" TEXT NOT NULL);")
  assert.equal(insertSql("user data", fields, { "id": "1", "display name": "Ada's" }), "INSERT INTO \"user data\" (\"id\", \"display name\") VALUES (1, 'Ada''s');")
  assert.equal(updateSql("user data", fields, { "id": "1", "display name": "Grace" }, fields[0], { id: "1" }), "UPDATE \"user data\" SET \"id\" = 1, \"display name\" = 'Grace' WHERE \"id\" = 1;")
  assert.equal(deleteSql("user data", fields[0], { id: "1" }), "DELETE FROM \"user data\" WHERE \"id\" = 1;")
})
