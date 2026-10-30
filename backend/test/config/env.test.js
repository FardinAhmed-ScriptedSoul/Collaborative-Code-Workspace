import assert from "node:assert/strict"
import test from "node:test"
import loadConfig from "../../src/config/env.js"

test("uses the local Orbit database defaults", () => {
  const config = loadConfig({})

  assert.equal(config.mongodbUri, "mongodb://localhost:27017/")
  assert.equal(config.databaseName, "Orbit")
  assert.equal(config.port, 3000)
})

test("loads MongoDB and server settings from the environment", () => {
  const config = loadConfig({
    MONGODB_URI: "mongodb://db.example:27017/",
    DB_NAME: "OrbitTest",
    PORT: "3100",
  })

  assert.equal(config.mongodbUri, "mongodb://db.example:27017/")
  assert.equal(config.databaseName, "OrbitTest")
  assert.equal(config.port, 3100)
})

test("rejects unsupported MongoDB URI schemes", () => {
  assert.throws(
    () => loadConfig({ MONGODB_URI: "http://localhost:27017" }),
    /MONGODB_URI must use/,
  )
})

test("rejects an empty database name", () => {
  assert.throws(
    () => loadConfig({ DB_NAME: "   " }),
    /DB_NAME must not be empty/,
  )
})

test("rejects an invalid port", () => {
  assert.throws(
    () => loadConfig({ PORT: "70000" }),
    /PORT must be an integer/,
  )
})
