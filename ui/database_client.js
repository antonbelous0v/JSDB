import { decodeResult } from "./result.js"

export class DatabaseClient {
  async query(sql) {
    const response = await fetch("/query", {
      method: "POST",
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: sql,
    })
    if (!response.ok) {
      throw new Error(await response.text())
    }
    return decodeResult(new Uint8Array(await response.arrayBuffer()))
  }

  async metadata() {
    const response = await fetch("/metadata")
    if (!response.ok) {
      throw new Error(await response.text())
    }
    return decodeResult(new Uint8Array(await response.arrayBuffer()))
  }
}
