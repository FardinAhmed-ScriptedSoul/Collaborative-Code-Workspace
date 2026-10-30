import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import test from "node:test"
import createApp from "../../src/app.js"

const jwtSecret = "auth-route-test-secret-that-is-at-least-32-characters"
const users = new Map()
const refreshSessions = new Map()

const database = {
  command: async () => ({ ok: 1 }),
  collection(name) {
    if (name === "users") {
      return {
        async findOne(query) {
          if (query.normalizedEmail) return users.get(query.normalizedEmail) ?? null
          if (query._id) {
            return Array.from(users.values()).find(
              (user) => user._id.equals(query._id),
            ) ?? null
          }
          return null
        },
        async insertOne(user) {
          if (users.has(user.normalizedEmail)) {
            const error = new Error("duplicate")
            error.code = 11000
            throw error
          }
          users.set(user.normalizedEmail, user)
          return { insertedId: user._id }
        },
      }
    }

    if (name === "refreshSessions") {
      return {
        async insertOne(session) {
          refreshSessions.set(session.tokenHash, session)
          return { insertedId: session.userId }
        },
        async findOneAndUpdate(query, update) {
          const session = refreshSessions.get(query.tokenHash)
          if (!session || session.revokedAt !== null || session.expiresAt <= query.expiresAt.$gt) {
            return null
          }
          refreshSessions.delete(query.tokenHash)
          Object.assign(session, update.$set)
          refreshSessions.set(session.tokenHash, session)
          return session
        },
        async updateOne(query, update) {
          const session = refreshSessions.get(query.tokenHash)
          if (session && session.revokedAt === null) Object.assign(session, update.$set)
          return { matchedCount: session ? 1 : 0 }
        },
      }
    }
    return {}
  },
}

async function withServer(run, { isProduction = false } = {}) {
  const server = createServer(createApp({ database, jwtSecret, isProduction }))
  server.listen(0, "127.0.0.1")
  await once(server, "listening")

  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    const closed = new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
    server.closeAllConnections()
    await closed
  }
}

function refreshCookie(response) {
  const cookie = response.headers.get("set-cookie")
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /SameSite=Lax/)
  return cookie.match(/workspace_refresh=([^;]+)/)[1]
}

test("registers, authenticates, rotates refresh tokens, and revokes sessions", async () => {
  const email = `registration-${Date.now()}@example.test`
  await withServer(async (baseUrl) => {
    const registration = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "Test User", password: "correct horse battery" }),
    })
    assert.equal(registration.status, 201)
    const registrationBody = await registration.json()
    assert.equal(registrationBody.user.email, email)
    assert.equal("passwordHash" in registrationBody.user, false)
    const originalRefreshToken = refreshCookie(registration)

    const unauthorized = await fetch(`${baseUrl}/api/auth/me`)
    assert.equal(unauthorized.status, 401)

    const profile = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${registrationBody.token}` },
    })
    assert.equal(profile.status, 200)
    assert.equal((await profile.json()).user.name, "Test User")

    const refreshed = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: `workspace_refresh=${originalRefreshToken}` },
    })
    assert.equal(refreshed.status, 200)
    const refreshedBody = await refreshed.json()
    assert.notEqual(refreshedBody.token, registrationBody.token)
    const rotatedRefreshToken = refreshCookie(refreshed)
    assert.notEqual(rotatedRefreshToken, originalRefreshToken)

    const replay = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: `workspace_refresh=${originalRefreshToken}` },
    })
    assert.equal(replay.status, 401)

    const badLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "incorrect password" }),
    })
    assert.equal(badLogin.status, 401)

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.toUpperCase(), password: "correct horse battery" }),
    })
    assert.equal(login.status, 200)
    const loginRefreshToken = refreshCookie(login)
    const logout = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: `workspace_refresh=${loginRefreshToken}` },
    })
    assert.equal(logout.status, 204)
    assert.match(logout.headers.get("set-cookie"), /Max-Age=0/)
    const afterLogout = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { cookie: `workspace_refresh=${loginRefreshToken}` },
    })
    assert.equal(afterLogout.status, 401)
  })
})

test("rejects weak passwords and duplicate email registrations", async () => {
  const email = `duplicate-${Date.now()}@example.test`
  await withServer(async (baseUrl) => {
    const sendRegistration = (password) => fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, name: "Test", password }),
    })

    assert.equal((await sendRegistration("short")).status, 400)
    assert.equal((await sendRegistration("a sufficiently long password")).status, 201)
    assert.equal((await sendRegistration("another sufficiently long password")).status, 409)
  })
})

test("marks refresh cookies Secure in production", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: `secure-${Date.now()}@example.test`,
        name: "Secure User",
        password: "correct horse battery",
      }),
    })
    assert.equal(response.status, 201)
    assert.match(response.headers.get("set-cookie"), /; Secure/)
  }, { isProduction: true })
})
