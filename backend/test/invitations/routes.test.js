import assert from "node:assert/strict"
import { createServer } from "node:http"
import { once } from "node:events"
import test from "node:test"
import { ObjectId } from "mongodb"
import createApp from "../../src/app.js"
import { createAccessToken } from "../../src/modules/auth/tokens.js"

const adminId = new ObjectId()
const invitedId = new ObjectId()
const organizationId = new ObjectId()
const projectId = new ObjectId()
const invitationRecords = new Map()
const organizationMembershipRecords = [{
  organizationId,
  userId: adminId,
  role: "owner",
}]
const projectMembershipRecords = []
const organization = {
  _id: organizationId,
  name: "Test organization",
}
const project = {
  _id: projectId,
  organizationId,
}
const users = new Map([
  [adminId.toString(), {
    _id: adminId,
    email: "admin@example.test",
    normalizedEmail: "admin@example.test",
    name: "Admin",
  }],
  [invitedId.toString(), {
    _id: invitedId,
    email: "invitee@example.test",
    normalizedEmail: "invitee@example.test",
    name: "Invitee",
  }],
])
const collections = {
  users: {
    async findOne(query) {
      return users.get(query._id?.toString()) ?? null
    },
  },
  organizations: {
    async findOne(query) {
      return query._id.equals(organizationId) ? organization : null
    },
    async deleteOne() { return { deletedCount: 1 } },
  },
  projects: {
    async findOne(query) {
      return query._id.equals(projectId) ? project : null
    },
    async deleteOne() { return { deletedCount: 1 } },
  },
  organizationMemberships: {
    async findOne(query) {
      return organizationMembershipRecords.find((membership) => (
        membership.organizationId.equals(query.organizationId)
        && membership.userId.equals(query.userId)
      )) ?? null
    },
    async insertOne(membership) {
      organizationMembershipRecords.push(membership)
      return { insertedId: new ObjectId() }
    },
  },
  projectMemberships: {
    async findOne(query) {
      return projectMembershipRecords.find((membership) => (
        membership.projectId.equals(query.projectId)
        && membership.userId.equals(query.userId)
      )) ?? null
    },
    async insertOne(membership) {
      projectMembershipRecords.push(membership)
      return { insertedId: new ObjectId() }
    },
    async updateOne(query, update) {
      const membership = projectMembershipRecords.find((item) => (
        item.projectId.equals(query.projectId) && item.userId.equals(query.userId)
      ))
      if (membership) Object.assign(membership, update.$set)
      else projectMembershipRecords.push({
        ...query,
        ...update.$setOnInsert,
        ...update.$set,
      })
      return { matchedCount: membership ? 1 : 0 }
    },
  },
  invitations: {
    async insertOne(invitation) {
      const id = new ObjectId()
      invitationRecords.set(id.toString(), { ...invitation, _id: id })
      return { insertedId: id }
    },
    async findOneAndDelete(query) {
      const entry = Array.from(invitationRecords.entries()).find(([, invitation]) => (
        invitation.tokenHash === query.tokenHash
        && invitation.email === query.email
        && invitation.expiresAt > query.expiresAt.$gt
      ))
      if (!entry) return null
      invitationRecords.delete(entry[0])
      return entry[1]
    },
  },
}
const database = { collection: (name) => collections[name] ?? {} }
const jwtSecret = "invitation-route-test-secret-that-is-at-least-32-characters"
const adminToken = createAccessToken(users.get(adminId.toString()), jwtSecret)
const invitedToken = createAccessToken(users.get(invitedId.toString()), jwtSecret)

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

test("project invitation is accepted only by the invited account and grants its role", async () => {
  await withServer(async (baseUrl) => {
    const created = await fetch(`${baseUrl}/api/invitations/projects/${projectId}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "invitee@example.test", role: "viewer" }),
    })
    assert.equal(created.status, 201)
    const { invitation } = await created.json()
    assert.equal(invitation.targetId, projectId.toString())
    assert.equal(invitation.role, "viewer")
    assert.equal(invitationRecords.values().next().value.tokenHash === invitation.token, false)

    const wrongAccount = await fetch(`${baseUrl}/api/invitations/accept`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: invitation.token }),
    })
    assert.equal(wrongAccount.status, 404)
    assert.equal(invitationRecords.size, 1)

    const accepted = await fetch(`${baseUrl}/api/invitations/accept`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${invitedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ token: invitation.token }),
    })
    assert.equal(accepted.status, 200)
    assert.deepEqual(projectMembershipRecords.map(({ userId, role }) => ({
      userId: userId.toString(),
      role,
    })), [{ userId: invitedId.toString(), role: "viewer" }])
    assert.equal(invitationRecords.size, 0)
  })
})
