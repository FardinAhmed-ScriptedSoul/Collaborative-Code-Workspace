import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import test from "node:test"
import { ObjectId } from "mongodb"
import * as Y from "yjs"
import { SocketIOProvider } from "y-socket.io"
import { createAccessToken } from "../../src/modules/auth/tokens.js"
import attachCollaborationServer, { closeCollaborationServer } from "../../src/collaboration/socketServer.js"

function waitForProviderSync(provider) {
  if (provider.synced) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      provider.off("sync", onSync)
      reject(new Error("Timed out waiting for collaboration sync"))
    }, 5000)
    const onSync = (synced) => {
      if (!synced) return
      clearTimeout(timeout)
      provider.off("sync", onSync)
      resolve()
    }

    provider.on("sync", onSync)
  })
}

function waitForText(text, expectedValue) {
  if (text.toString() === expectedValue) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      text.unobserve(onChange)
      reject(new Error("Timed out waiting for the collaborative text update"))
    }, 5000)
    const onChange = () => {
      if (text.toString() !== expectedValue) return
      clearTimeout(timeout)
      text.unobserve(onChange)
      resolve()
    }

    text.observe(onChange)
  })
}

function waitForUsername(awareness, username) {
  const hasUsername = () => Array.from(awareness.getStates().values())
    .some((state) => state.user?.username === username)
  if (hasUsername()) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      awareness.off("change", onChange)
      reject(new Error("Timed out waiting for participant presence"))
    }, 5000)
    const onChange = () => {
      if (!hasUsername()) return
      clearTimeout(timeout)
      awareness.off("change", onChange)
      resolve()
    }

    awareness.on("change", onChange)
  })
}

function assertTextRemainsUnchanged(text, expectedValue, duration = 100) {
  return new Promise((resolve, reject) => {
    const onChange = () => {
      clearTimeout(timeout)
      text.unobserve(onChange)
      reject(new Error("A document update crossed collaboration rooms"))
    }
    const timeout = setTimeout(() => {
      text.unobserve(onChange)
      assert.equal(text.toString(), expectedValue)
      resolve()
    }, duration)

    text.observe(onChange)
  })
}

test("synchronizes edits within a room and isolates other rooms", async (t) => {
  const userId = new ObjectId()
  const firstProjectId = new ObjectId().toString()
  const otherProjectId = new ObjectId().toString()
  const user = {
    _id: userId,
    email: "alex@example.test",
    normalizedEmail: "alex@example.test",
    name: "Alex",
  }
  const projectDocuments = new Map([
    [firstProjectId, {
      _id: new ObjectId(firstProjectId),
      organizationId: new ObjectId(),
      name: "First project",
    }],
    [otherProjectId, {
      _id: new ObjectId(otherProjectId),
      organizationId: new ObjectId(),
      name: "Other project",
    }],
  ])
  const repositories = {
    users: {
      async findById(id) {
        return id.equals(userId) ? user : null
      },
    },
    projects: {
      async getAccess(projectId, id) {
        const project = projectDocuments.get(projectId)
        if (!project || !id.equals(userId)) return null
        return { project, role: "editor" }
      },
    },
    collaboration: {
      async insertMessage() {},
    },
  }
  const getProjectAccess = (projectId, id) => repositories.projects.getAccess(projectId, id)
  const jwtSecret = "integration-test-secret-that-is-at-least-32-characters"
  const token = createAccessToken(user, jwtSecret)
  const httpServer = createServer()
  const io = attachCollaborationServer(httpServer, { repositories, getProjectAccess, jwtSecret })
  httpServer.listen(0, "127.0.0.1")
  await once(httpServer, "listening")

  const serverUrl = `http://127.0.0.1:${httpServer.address().port}`
  const providers = []
  const documents = []
  const createProvider = (projectId) => {
    const document = new Y.Doc()
    const provider = new SocketIOProvider(serverUrl, projectId, document, {
      disableBc: true,
      auth: { token, projectId },
    })
    documents.push(document)
    providers.push(provider)
    return { document, provider }
  }

  t.after(async () => {
    for (const provider of providers) provider.destroy()
    for (const document of documents) document.destroy()
    await closeCollaborationServer(io)
  })

  const firstRoomPeer = createProvider(firstProjectId)
  const secondRoomPeer = createProvider(firstProjectId)
  const otherRoomPeer = createProvider(otherProjectId)

  await Promise.all([
    waitForProviderSync(firstRoomPeer.provider),
    waitForProviderSync(secondRoomPeer.provider),
    waitForProviderSync(otherRoomPeer.provider),
  ])

  const firstRoomText = firstRoomPeer.document.getText("monaco")
  const secondRoomText = secondRoomPeer.document.getText("monaco")
  const otherRoomText = otherRoomPeer.document.getText("monaco")
  const secondRoomUpdate = waitForText(secondRoomText, "shared edit")
  const otherRoomIsolation = assertTextRemainsUnchanged(otherRoomText, "")
  firstRoomText.insert(0, "shared edit")

  await Promise.all([secondRoomUpdate, otherRoomIsolation])
  const participantPresence = waitForUsername(
    secondRoomPeer.provider.awareness,
    "Alex",
  )
  firstRoomPeer.provider.awareness.setLocalStateField("user", { username: "Alex" })
  await participantPresence

  assert.equal(firstRoomText.toString(), "shared edit")
  assert.equal(secondRoomText.toString(), "shared edit")
  assert.equal(otherRoomText.toString(), "")
  assert.equal(
    Array.from(otherRoomPeer.provider.awareness.getStates().values())
      .some((state) => state.user?.username === "Alex"),
    false,
  )
})
