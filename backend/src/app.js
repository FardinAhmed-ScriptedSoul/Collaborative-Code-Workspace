import express from "express"

function createApp({ database }) {
  const app = express()

  app.get("/", (_request, response) => {
    response.status(200).json({
      message: "Hello from the backend!",
      success: true,
    })
  })

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" })
  })

  app.get("/health/ready", async (_request, response) => {
    try {
      await database.command({ ping: 1 })
      response.status(200).json({ status: "ready", database: "ok" })
    } catch (error) {
      console.error("Database readiness check failed", error)
      response.status(503).json({ status: "not_ready", database: "unavailable" })
    }
  })

  return app
}

export default createApp
