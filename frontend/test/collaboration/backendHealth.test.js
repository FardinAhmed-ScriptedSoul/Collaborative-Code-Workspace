import assert from "node:assert/strict"
import test from "node:test"
import { fetchBackendHealth } from "../../src/features/collaboration/backendHealth.js"

test("reports a ready backend response", async () => {
  const health = await fetchBackendHealth(async (url) => {
    assert.equal(url, "/health/ready")
    return {
      ok: true,
      json: async () => ({ status: "ready", database: "ok" }),
    }
  })

  assert.deepEqual(health, { status: "ready", database: "ok" })
})

test("rejects unsuccessful health responses", async () => {
  await assert.rejects(
    fetchBackendHealth(async () => ({ ok: false, status: 503 })),
    /HTTP 503/,
  )
})

test("rejects a successful response with an unready status", async () => {
  await assert.rejects(
    fetchBackendHealth(async () => ({
      ok: true,
      json: async () => ({ status: "not_ready", database: "unavailable" }),
    })),
    /Backend is not ready/,
  )
})
