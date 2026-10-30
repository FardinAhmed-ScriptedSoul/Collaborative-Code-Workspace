import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import test from "node:test"
import createApp from "../src/app.js"

async function withApp(database, run) {
  database.collection ??= () => ({})
  const server = createServer(createApp({
    database,
    jwtSecret: "backend-test-secret-that-is-at-least-32-characters",
  }))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    const closePromise = new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    server.closeAllConnections()
    await closePromise
  }
}

test("exposes liveness and readiness endpoints for frontend health checks", async () => {
  const database = {
    command: async (command) => {
      assert.deepEqual(command, { ping: 1 })
      return { ok: 1 }
    },
  }

  await withApp(database, async (baseUrl) => {
    const liveness = await fetch(`${baseUrl}/health`)
    assert.equal(liveness.status, 200)
    assert.deepEqual(await liveness.json(), { status: "ok" })

    const readiness = await fetch(`${baseUrl}/health/ready`)
    assert.equal(readiness.status, 200)
    assert.deepEqual(await readiness.json(), { status: "ready", database: "ok" })
  })
})

test("reports database failures as not ready", async () => {
  const originalConsoleError = console.error
  console.error = () => {}

  try {
    await withApp({
      command: async () => {
        throw new Error("database unavailable")
      },
      collection: () => ({}),
    }, async (baseUrl) => {
      const readiness = await fetch(`${baseUrl}/health/ready`)
      assert.equal(readiness.status, 503)
      assert.deepEqual(await readiness.json(), {
        status: "not_ready",
        database: "unavailable",
      })
    })
  } finally {
    console.error = originalConsoleError
  }
})
