import "dotenv/config"
import { createServer } from "http"
import createApp from "./app.js"
import loadConfig from "./config/env.js"
import attachCollaborationServer, { closeCollaborationServer } from "./collaboration/socketServer.js"
import connectToDatabase, { closeDatabase } from "./infrastructure/database/mongoDatabase.js"
import { ensureDatabaseIndexes } from "./infrastructure/database/indexes.js"
import { createMongoRepositories } from "./infrastructure/database/repositories.js"
import { createProjectAccessService } from "./modules/projects/access.js"

async function startServer() {
  const config = loadConfig()
  let connection
  try {
    connection = await connectToDatabase(config)
    await ensureDatabaseIndexes(connection.database)
  } catch (error) {
    throw new Error(
      `${error.message}. Make sure MongoDB is running; on Windows start the MongoDB service from an elevated terminal, or run "docker compose up -d mongodb" from the repository root.`,
      { cause: error },
    )
  }

  const { database } = connection
  const repositories = createMongoRepositories(database)
  const getProjectAccess = createProjectAccessService(repositories.projects)
  const httpServer = createServer()
  const io = attachCollaborationServer(httpServer, {
    repositories,
    getProjectAccess,
    jwtSecret: config.jwtSecret,
    jwtIssuer: config.jwtIssuer,
    jwtAudience: config.jwtAudience,
    yjsPersistenceDirectory: config.yjsPersistenceDirectory,
    allowedOrigins: config.allowedOrigins,
  })
  httpServer.on("request", createApp({
    database,
    repositories,
    jwtSecret: config.jwtSecret,
    jwtIssuer: config.jwtIssuer,
    jwtAudience: config.jwtAudience,
    accessTokenTtlSeconds: config.accessTokenTtlSeconds,
    refreshTokenTtlDays: config.refreshTokenTtlDays,
    allowedOrigins: config.allowedOrigins,
    isProduction: config.isProduction,
    io,
  }))

  try {
    await new Promise((resolve, reject) => {
      httpServer.once("error", reject)
      httpServer.listen(config.port, resolve)
    })
  } catch (error) {
    const cleanupErrors = []
    try {
      await closeCollaborationServer(io)
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }
    try {
      await closeDatabase()
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError)
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError([error, ...cleanupErrors], "Backend startup failed and cleanup was incomplete", {
        cause: error,
      })
    }

    throw error
  }

  console.log(`Server is running on port ${config.port}; MongoDB database "${config.databaseName}" is connected`)

  let isShuttingDown = false
  const shutdown = async (signal) => {
    if (isShuttingDown) return
    isShuttingDown = true
    console.log(`${signal} received; shutting down`)

    const shutdownErrors = []
    try {
      await closeCollaborationServer(io)
    } catch (error) {
      shutdownErrors.push(error)
    }
    try {
      await closeDatabase()
    } catch (error) {
      shutdownErrors.push(error)
    }

    if (shutdownErrors.length > 0) {
      const error = shutdownErrors.length === 1
        ? shutdownErrors[0]
        : new AggregateError(shutdownErrors, "Multiple errors occurred during shutdown")
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
