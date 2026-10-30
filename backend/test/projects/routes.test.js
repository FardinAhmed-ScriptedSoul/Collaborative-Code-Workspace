import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import test from "node:test"
import { ObjectId } from "mongodb"
import createApp from "../../src/app.js"
import { createAccessToken } from "../../src/modules/auth/tokens.js"

const userId = new ObjectId()
const organizationId = new ObjectId()
const projectId = new ObjectId()
const user = {
  _id: userId,
  email: "viewer@example.test",
  normalizedEmail: "viewer@example.test",
  name: "Viewer",
}
const project = {
  _id: projectId,
  organizationId,
  name: "Read-only project",
  createdAt: new Date(),
}
const organization = {
  _id: organizationId,
  name: "Workspace",
}
const database = {
  collection(name) {
    if (name === "users") {
      return {
        async findOne(query) {
          return query._id?.equals(userId) ? user : null
        },
      }
    }
    if (name === "projects") {
      return {
        async findOne(query) {
          return query._id?.equals(projectId) ? project : null
        },
      }
    }
    if (name === "organizations") {
      return {
        async findOne(query) {
          return query._id?.equals(organizationId) ? organization : null
        },
      }
    }
    if (name === "organizationMemberships") {
      return {
        async findOne(query) {
          return query.organizationId?.equals(organizationId)
            && query.userId?.equals(userId)
            ? { organizationId, userId, role: "member" }
            : null
        },
      }
    }
    if (name === "projectMemberships") {
      return {
        async findOne(query) {
          return query.projectId?.equals(projectId) && query.userId?.equals(userId)
            ? { projectId, userId, role: "viewer" }
            : null
        },
      }
    }
    return {}
  },
}
const jwtSecret = "project-route-test-secret-that-is-at-least-32-characters"
const token = createAccessToken(user, jwtSecret)

async function withServer(run) {
  const server = createServer(createApp({ database, jwtSecret }))
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

test("serves project membership and blocks viewer write operations", async () => {
  await withServer(async (baseUrl) => {
    const projectResponse = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(projectResponse.status, 200)
    assert.equal((await projectResponse.json()).project.role, "viewer")

    const editResponse = await fetch(`${baseUrl}/api/projects/${projectId}/edit-check`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    })
    assert.equal(editResponse.status, 403)

    const snapshotResponse = await fetch(`${baseUrl}/api/projects/${projectId}/snapshots`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "unauthorized", code: "do not save" }),
    })
    assert.equal(snapshotResponse.status, 403)

    const messageResponse = await fetch(`${baseUrl}/api/projects/${projectId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: "viewer write attempt" }),
    })
    assert.equal(messageResponse.status, 403)

    const discussionResponse = await fetch(`${baseUrl}/api/projects/${projectId}/discussions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        startLine: 1,
        endLine: 1,
        selectedText: "code",
        body: "viewer write attempt",
      }),
    })
    assert.equal(discussionResponse.status, 403)
  })
})
