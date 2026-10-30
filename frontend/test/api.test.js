import assert from "node:assert/strict"
import test from "node:test"
import {
  apiRequest,
  getAccessToken,
  setAccessToken,
  subscribeAccessToken,
} from "../src/shared/api.js"

test("keeps access tokens in memory and refreshes once after an expired token", async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  const observedTokens = []
  const unsubscribe = subscribeAccessToken(() => observedTokens.push(getAccessToken()))
  setAccessToken("expired-access-token")
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options })
    if (path === "/api/auth/refresh") {
      return Response.json({ token: "rotated-access-token", user: { id: "user-1" } })
    }
    if (requests.filter((request) => request.path === path).length === 1) {
      return Response.json({ error: "Authentication required" }, { status: 401 })
    }
    return Response.json({ projects: [] })
  }

  try {
    const result = await apiRequest("/api/projects")
    assert.deepEqual(result, { projects: [] })
    assert.equal(getAccessToken(), "rotated-access-token")
    assert.equal(requests.length, 3)
    assert.equal(requests[0].options.headers.get("Authorization"), "Bearer expired-access-token")
    assert.equal(requests[2].options.headers.get("Authorization"), "Bearer rotated-access-token")
    assert.equal(requests.every(({ options }) => options.credentials === "include"), true)
    assert.deepEqual(observedTokens, ["expired-access-token", "rotated-access-token"])
  } finally {
    unsubscribe()
    setAccessToken(null)
    globalThis.fetch = originalFetch
  }
})
