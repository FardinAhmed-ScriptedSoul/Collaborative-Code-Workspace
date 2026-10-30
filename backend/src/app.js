import express from "express"

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

export default app
