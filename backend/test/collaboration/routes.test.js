import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import test from "node:test"
import { ObjectId } from "mongodb"
import createApp from "../../src/app.js"
import { createAccessToken } from "../../src/modules/auth/tokens.js"

const editorId = new ObjectId()
const viewerId = new ObjectId()
const organizationId = new ObjectId()
const projectId = new ObjectId()
const project = {
  _id: projectId,
  organizationId,
  name: "Collaboration project",
}
const users = new Map([
  [editorId.toString(), {
    _id: editorId,
    email: "editor@example.test",
    normalizedEmail: "editor@example.test",
    name: "Editor",
  }],
  [viewerId.toString(), {
    _id: viewerId,
    email: "viewer@example.test",
    normalizedEmail: "viewer@example.test",
    name: "Viewer",
  }],
])
const projectMemberships = new Map([
  [editorId.toString(), { projectId, userId: editorId, role: "editor" }],
  [viewerId.toString(), { projectId, userId: viewerId, role: "viewer" }],
])
const documents = new Map([
  ["messages", new Map()],
  ["discussions", new Map()],
  ["snapshots", new Map()],
])
const database = {
  collection(name) {
    if (name === "users") {
      return {
        async findOne(query) {
          return users.get(query._id?.toString()) ?? null
        },
      }
    }
    if (name === "projects") {
      return {
        async findOne(query) {
          return query._id.equals(projectId) ? project : null
        },
      }
    }
    if (name === "organizations") {
      return { async findOne() { return null } }
    }
    if (name === "organizationMemberships") {
      return { async findOne() { return null } }
    }
    if (name === "projectMemberships") {
      return {
        async findOne(query) {
          return projectMemberships.get(query.userId?.toString()) ?? null
        },
      }
    }
    const records = documents.get(name)
    if (!records) return {}
    return {
      async insertOne(record) {
        records.set(record._id.toString(), record)
        return { insertedId: record._id }
      },
      async findOne(query) {
        const record = records.get(query._id?.toString())
        return record?.projectId.equals(query.projectId) ? record : null
      },
      find(query) {
        let limit = Infinity
        let projection
        return {
          project(value) {
            projection = value
            return this
          },
          sort() { return this },
          limit(value) {
            limit = value
            return this
          },
          async toArray() {
            let results = Array.from(records.values()).filter((record) => (
              record.projectId.equals(query.projectId)
              && (!query.createdAt || record.createdAt < query.createdAt.$lt)
            )).sort((left, right) => (
              right.createdAt - left.createdAt || right._id.toString().localeCompare(left._id.toString())
            )).slice(0, limit)
            if (projection?.code === 0) {
              results = results.map(({ code: _code, ...record }) => record)
            }
            return results
          },
        }
      },
      async updateOne(query, update) {
        const record = records.get(query._id.toString())
        if (!record || !record.projectId.equals(query.projectId)) return { matchedCount: 0 }
        Object.assign(record, update.$set)
        return { matchedCount: 1 }
      },
      async deleteOne(query) {
        return { deletedCount: Number(records.delete(query._id.toString())) }
      },
    }
  },
}
const jwtSecret = "collaboration-routes-test-secret-at-least-32-characters"
const tokens = new Map([
  [editorId.toString(), createAccessToken(users.get(editorId.toString()), jwtSecret)],
  [viewerId.toString(), createAccessToken(users.get(viewerId.toString()), jwtSecret)],
])

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

function authHeaders(userId, includeJson = false) {
  return {
    authorization: `Bearer ${tokens.get(userId.toString())}`,
    ...(includeJson ? { "content-type": "application/json" } : {}),
  }
}

test("persists paged chat, anchored discussions, and named snapshots with role enforcement", async () => {
  documents.get("messages").clear()
  documents.get("discussions").clear()
  documents.get("snapshots").clear()

  await withServer(async (baseUrl) => {
    const messageResponse = await fetch(`${baseUrl}/api/projects/${projectId}/messages`, {
      method: "POST",
      headers: authHeaders(editorId, true),
      body: JSON.stringify({ body: " durable message " }),
    })
    assert.equal(messageResponse.status, 201)
    const { message } = await messageResponse.json()
    assert.equal(message.body, "durable message")
    assert.equal(message.author.id, editorId.toString())
    assert.ok(message.createdAt)

    for (let index = 0; index < 51; index += 1) {
      const id = new ObjectId()
      documents.get("messages").set(id.toString(), {
        _id: id,
        projectId,
        author: { id: editorId.toString(), name: "Editor" },
        body: `message ${index}`,
        createdAt: new Date(Date.now() - index * 1000),
      })
    }
    const firstPage = await fetch(`${baseUrl}/api/projects/${projectId}/messages?limit=50`, {
      headers: authHeaders(editorId),
    })
    const firstPageBody = await firstPage.json()
    assert.equal(firstPageBody.messages.length, 50)
    assert.equal(firstPageBody.hasMore, true)
    assert.ok(firstPageBody.nextBefore)
    const secondPage = await fetch(
      `${baseUrl}/api/projects/${projectId}/messages?limit=50&before=${encodeURIComponent(firstPageBody.nextBefore)}`,
      { headers: authHeaders(editorId) },
    )
    const secondPageBody = await secondPage.json()
    assert.equal(secondPageBody.messages.length, 2)
    assert.equal(secondPageBody.hasMore, false)

    const viewerEdit = await fetch(
      `${baseUrl}/api/projects/${projectId}/messages/${message.id}`,
      {
        method: "PATCH",
        headers: authHeaders(viewerId, true),
        body: JSON.stringify({ body: "not allowed" }),
      },
    )
    assert.equal(viewerEdit.status, 403)
    const editedMessage = await fetch(
      `${baseUrl}/api/projects/${projectId}/messages/${message.id}`,
      {
        method: "PATCH",
        headers: authHeaders(editorId, true),
        body: JSON.stringify({ body: "updated message" }),
      },
    )
    assert.equal((await editedMessage.json()).message.body, "updated message")
    const deletedMessage = await fetch(
      `${baseUrl}/api/projects/${projectId}/messages/${message.id}`,
      { method: "DELETE", headers: authHeaders(editorId) },
    )
    assert.equal(deletedMessage.status, 204)

    const viewerMessage = await fetch(`${baseUrl}/api/projects/${projectId}/messages`, {
      method: "POST",
      headers: authHeaders(viewerId, true),
      body: JSON.stringify({ body: "not allowed" }),
    })
    assert.equal(viewerMessage.status, 403)

    const discussionResponse = await fetch(`${baseUrl}/api/projects/${projectId}/discussions`, {
      method: "POST",
      headers: authHeaders(editorId, true),
      body: JSON.stringify({
        startLine: 3,
        endLine: 4,
        selectedText: "const answer = 42",
        body: "Discuss this code",
      }),
    })
    assert.equal(discussionResponse.status, 201)
    const { discussion } = await discussionResponse.json()
    assert.equal(discussion.anchor.startLine, 3)
    assert.equal(discussion.status, "open")
    assert.ok(discussion.id)

    const viewerDiscussion = await fetch(`${baseUrl}/api/projects/${projectId}/discussions`, {
      method: "POST",
      headers: authHeaders(viewerId, true),
      body: JSON.stringify({
        startLine: 1,
        endLine: 1,
        selectedText: "code",
        body: "not allowed",
      }),
    })
    assert.equal(viewerDiscussion.status, 403)

    const resolveResponse = await fetch(
      `${baseUrl}/api/projects/${projectId}/discussions/${discussion.id}`,
      {
        method: "PATCH",
        headers: authHeaders(editorId, true),
        body: JSON.stringify({ status: "resolved" }),
      },
    )
    assert.equal((await resolveResponse.json()).discussion.status, "resolved")
    const discussionHistory = await fetch(`${baseUrl}/api/projects/${projectId}/discussions`, {
      headers: authHeaders(viewerId),
    })
    assert.equal((await discussionHistory.json()).discussions[0].status, "resolved")

    const snapshotResponse = await fetch(`${baseUrl}/api/projects/${projectId}/snapshots`, {
      method: "POST",
      headers: authHeaders(editorId, true),
      body: JSON.stringify({ name: "Known good", code: "const answer = 42" }),
    })
    assert.equal(snapshotResponse.status, 201)
    const snapshot = (await snapshotResponse.json()).snapshot
    const snapshotHistory = await fetch(`${baseUrl}/api/projects/${projectId}/snapshots`, {
      headers: authHeaders(viewerId),
    })
    assert.equal((await snapshotHistory.json()).snapshots[0].name, "Known good")

    const restoredSnapshot = await fetch(
      `${baseUrl}/api/projects/${projectId}/snapshots/${snapshot.id}`,
      { headers: authHeaders(viewerId) },
    )
    assert.equal((await restoredSnapshot.json()).snapshot.code, "const answer = 42")
  })
})
