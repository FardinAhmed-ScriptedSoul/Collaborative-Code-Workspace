import { MongoClient } from "mongodb"

export function createMongoDatabase({ MongoClientClass = MongoClient } = {}) {
  let connectionPromise
  let activeConfig

  async function connect({ mongodbUri, databaseName }) {
    const configKey = JSON.stringify([mongodbUri, databaseName])

    if (connectionPromise) {
      if (configKey !== activeConfig) {
        throw new Error("MongoDB is already connected with a different configuration")
      }

      return connectionPromise
    }

    activeConfig = configKey
    connectionPromise = (async () => {
      const client = new MongoClientClass(mongodbUri, {
        appName: "orbit-backend",
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
      })

      try {
        await client.connect()
        const database = client.db(databaseName)
        await database.command({ ping: 1 })

        return { client, database }
      } catch (error) {
        try {
          await client.close()
        } catch (closeError) {
          throw new AggregateError(
            [error, closeError],
            `Could not connect to MongoDB database "${databaseName}" and failed to close its client`,
          )
        }

        throw new Error(`Could not connect to MongoDB database "${databaseName}"`, {
          cause: error,
        })
      }
    })()

    try {
      return await connectionPromise
    } catch (error) {
      connectionPromise = undefined
      activeConfig = undefined
      throw error
    }
  }

  async function close() {
    const currentConnection = connectionPromise
    connectionPromise = undefined
    activeConfig = undefined

    if (!currentConnection) return

    const { client } = await currentConnection
    await client.close()
  }

  return { connect, close }
}

const mongoDatabase = createMongoDatabase()

export const closeDatabase = mongoDatabase.close
export default mongoDatabase.connect
