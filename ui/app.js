import { DatabaseClient } from "./database_client.js"
import { QueryController } from "./query_controller.js"
import { createView } from "./view.js"

const client = new DatabaseClient()
let view = null

const controller = new QueryController(client, (state) => {
  view?.render(state)
})

view = createView({
  onSelectTable: name => controller.selectTable(name),
  onExecuteSql: sql => controller.executeSql(sql),
  onNewRecord: () => controller.newRecord(),
  onDeleteRows: indices => controller.deleteRows(indices),
  onCellEdit: (rowIndex, colIndex, value) => controller.setCell(rowIndex, colIndex, value),
  onApply: () => controller.applyChanges(),
  onRevert: () => controller.revert(),
  onSwitchTab: tab => controller.update({ tab }),
  onCreateTable: definition => controller.createTable(definition),
  onDropTable: name => controller.dropTable(name),
})

controller.loadMetadata()
