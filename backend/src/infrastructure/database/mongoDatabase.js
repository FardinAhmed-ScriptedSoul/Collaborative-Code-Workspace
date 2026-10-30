import { MongoClient } from "mongodb"

async function connectToDatabase({ mongodbUri, databaseName }) {
  const client = new MongoClient(mongodbUri, {
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
    await client.close()
    throw new Error(`Could not connect to MongoDB database "${databaseName}"`, {
      cause: error,
    })
  }
}

export default connectToDatabase
