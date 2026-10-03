import net from "node:net"

import { MessageDecoder, MessageType, encodeMessage, encodeStartup, encodeTextMessage } from "../js/protocol/message.js"

export class DatabaseConnection {
  constructor(host, port) {
    this.host = host
    this.port = port
    this.socket = null
    this.decoder = new MessageDecoder()
    this.pending = null
    this.messages = []
    this.starting = null
  }

  connect() {
    if (this.starting) {
      return this.starting
    }
    if (this.socket && !this.socket.destroyed) {
      return Promise.resolve()
    }
    this.starting = new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port }, () => {
        this.pending = { resolve: () => {
          this.pending = null
          resolve()
        }, reject }
        socket.write(encodeStartup())
      })
      socket.on("data", chunk => this.receive(chunk))
      socket.on("error", (error) => {
        if (this.pending) {
          this.pending.reject(error)
          this.pending = null
        }
      })
      socket.on("close", () => {
        if (this.pending) {
          this.pending.reject(new Error("Database connection closed"))
          this.pending = null
        }
        this.socket = null
      })
      socket.once("error", reject)
      this.socket = socket
    })
    return this.starting.finally(() => {
      this.starting = null
    })
  }

  query(sql) {
    return this.request(encodeTextMessage(MessageType.QUERY, sql))
  }

  metadata() {
    return this.request(encodeMessage(MessageType.METADATA))
  }

  async request(message) {
    if (this.pending) {
      throw new Error("A query is already running")
    }
    await this.connect()
    if (this.pending) {
      throw new Error("A query is already running")
    }
    return new Promise((resolve, reject) => {
      this.messages = []
      this.pending = { resolve, reject }
      this.socket.write(message)
    })
  }

  receive(chunk) {
    for (const message of this.decoder.write(chunk)) {
      const encoded = new Uint8Array(message.payload.length + 5)
      encoded[0] = message.type
      new DataView(encoded.buffer).setUint32(1, message.payload.length + 4, false)
      encoded.set(message.payload, 5)
      this.messages[this.messages.length] = encoded
      if (message.type === MessageType.READY_FOR_QUERY && this.pending) {
        const result = Buffer.concat(this.messages.map(value => Buffer.from(value)))
        this.pending.resolve(result)
        this.pending = null
      }
    }
  }

  close() {
    const error = new Error("Database connection closed")
    this.pending?.reject(error)
    this.pending = null
    this.starting = null
    this.messages = []
    this.decoder = new MessageDecoder()
    this.socket?.destroy()
    this.socket = null
  }
}
