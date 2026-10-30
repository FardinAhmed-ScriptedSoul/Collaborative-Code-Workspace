import "dotenv/config"
import { createServer } from "http"
import createApp from "./app.js"
import loadConfig from "./config/env.js"
import attachCollaborationServer from "./collaboration/socketServer.js"
import connectToDatabase from "./infrastructure/database/mongoDatabase.js"

async function startServer() {
  const config = loadConfig()
  const { client, database } = await connectToDatabase(config)
  const httpServer = createServer(createApp({ database }))
  const io = attachCollaborationServer(httpServer)

  try {
    await new Promise((resolve, reject) => {
      httpServer.once("error", reject)
      httpServer.listen(config.port, resolve)
    })
  } catch (error) {
    await new Promise((resolve) => io.close(resolve))
    await client.close()
    throw error
  }

  console.log(`Server is running on port ${config.port}; MongoDB database "${config.databaseName}" is connected`)

  let isShuttingDown = false
  const shutdown = async (signal) => {
    if (isShuttingDown) return
    isShuttingDown = true
    console.log(`${signal} received; shutting down`)

    try {
      await new Promise((resolve) => io.close(resolve))
      await client.close()
    } catch (error) {
      console.error("Error during graceful shutdown", error)
      process.exitCode = 1
    }
  }

  process.once("SIGINT", () => shutdown("SIGINT"))
  process.once("SIGTERM", () => shutdown("SIGTERM"))
}

startServer().catch((error) => {
  console.error("Backend startup failed", error)
  process.exitCode = 1
})
