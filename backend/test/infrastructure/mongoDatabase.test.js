import assert from "node:assert/strict"
import test from "node:test"
import { createMongoDatabase } from "../../src/infrastructure/database/mongoDatabase.js"

const config = {
  mongodbUri: "mongodb://localhost:27017/",
  databaseName: "OrbitTest",
}

function createFakeMongoClientClass({ connectError } = {}) {
  const clients = []

  class FakeMongoClient {
    constructor(uri, options) {
      this.uri = uri
      this.options = options
      this.connectCount = 0
      this.closeCount = 0
      this.pingCount = 0
      clients.push(this)
    }

    async connect() {
      this.connectCount += 1
      const error = typeof connectError === "function" ? connectError(this) : connectError
      if (error) throw error
    }

    db(name) {
      this.databaseName = name
      return {
        command: async (command) => {
          assert.deepEqual(command, { ping: 1 })
          this.pingCount += 1
        },
      }
    }

    async close() {
      this.closeCount += 1
    }
  }

  return { MongoClientClass: FakeMongoClient, clients }
}

test("reuses one MongoDB connection for concurrent requests", async () => {
  const { MongoClientClass, clients } = createFakeMongoClientClass()
  const mongoDatabase = createMongoDatabase({ MongoClientClass })

  const [first, second] = await Promise.all([
    mongoDatabase.connect(config),
    mongoDatabase.connect(config),
  ])

  assert.equal(first, second)
  assert.equal(clients.length, 1)
  assert.equal(clients[0].connectCount, 1)
  assert.equal(clients[0].pingCount, 1)
  assert.equal(clients[0].databaseName, "OrbitTest")
})

test("rejects a second configuration until the singleton connection is closed", async () => {
  const { MongoClientClass, clients } = createFakeMongoClientClass()
  const mongoDatabase = createMongoDatabase({ MongoClientClass })
  await mongoDatabase.connect(config)

  await assert.rejects(
    mongoDatabase.connect({ ...config, databaseName: "OtherDatabase" }),
    /different configuration/,
  )

  await mongoDatabase.close()
  await mongoDatabase.connect({ ...config, databaseName: "OtherDatabase" })
  assert.equal(clients.length, 2)
})

test("cleans up a client and permits retry after a failed connection", async () => {
  const failure = new Error("connection failed")
  let shouldFail = true
  const { MongoClientClass, clients } = createFakeMongoClientClass({
    connectError: () => {
      if (!shouldFail) return undefined
      shouldFail = false
      return failure
    },
  })
  const mongoDatabase = createMongoDatabase({ MongoClientClass })

  await assert.rejects(mongoDatabase.connect(config), {
    message: 'Could not connect to MongoDB database "OrbitTest"',
    cause: failure,
  })

  assert.equal(clients[0].closeCount, 1)
  await mongoDatabase.connect(config)
  assert.equal(clients.length, 2)
})

test("closes and clears the active singleton connection", async () => {
  const { MongoClientClass, clients } = createFakeMongoClientClass()
  const mongoDatabase = createMongoDatabase({ MongoClientClass })
  await mongoDatabase.connect(config)

  await mongoDatabase.close()
  await mongoDatabase.close()

  assert.equal(clients[0].closeCount, 1)
})
