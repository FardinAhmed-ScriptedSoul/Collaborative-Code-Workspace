import assert from "node:assert/strict"
import test from "node:test"
import { ObjectId } from "mongodb"
import {
  createAccessToken,
  createRefreshToken,
  getBearerToken,
  hashRefreshToken,
  hashPassword,
  verifyAccessToken,
  verifyPassword,
} from "../../src/modules/auth/tokens.js"

const secret = "unit-test-secret-that-is-at-least-32-characters"

test("hashes passwords with a salted scrypt hash and verifies them", async () => {
  const firstHash = await hashPassword("correct horse battery staple")
  const secondHash = await hashPassword("correct horse battery staple")

  assert.notEqual(firstHash, secondHash)
  assert.equal(await verifyPassword("correct horse battery staple", firstHash), true)
  assert.equal(await verifyPassword("incorrect password", firstHash), false)
  assert.equal(await verifyPassword("password", "invalid"), false)
})

test("signs and verifies tokens and rejects tampering or invalid signatures", () => {
  const user = { _id: new ObjectId(), email: "person@example.test" }
  const token = createAccessToken(user, secret)

  assert.equal(verifyAccessToken(token, secret).sub, user._id.toString())
  assert.equal(verifyAccessToken(token, secret).aud, "collaborative-code-workspace-web")
  assert.equal(verifyAccessToken(token, "wrong secret"), null)
  assert.equal(verifyAccessToken(token, secret, { audience: "another-client" }), null)
  assert.equal(verifyAccessToken(`${token}x`, secret), null)
  assert.equal(verifyAccessToken("bad.token", secret), null)
})

test("refresh tokens are opaque random values stored only as stable hashes", () => {
  const firstToken = createRefreshToken()
  const secondToken = createRefreshToken()

  assert.match(firstToken, /^[A-Za-z0-9_-]{40,60}$/)
  assert.notEqual(firstToken, secondToken)
  assert.notEqual(hashRefreshToken(firstToken), firstToken)
  assert.equal(hashRefreshToken(firstToken), hashRefreshToken(firstToken))
})

test("parses only bearer authorization headers", () => {
  assert.equal(getBearerToken("Bearer abc.def-123"), "abc.def-123")
  assert.equal(getBearerToken("Basic abc"), null)
  assert.equal(getBearerToken("Bearer abc spaces"), null)
})
