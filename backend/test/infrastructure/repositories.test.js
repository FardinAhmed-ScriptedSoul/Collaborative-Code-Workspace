import assert from "node:assert/strict"
import test from "node:test"
import { ObjectId } from "mongodb"
import { ensureDatabaseIndexes } from "../../src/infrastructure/database/indexes.js"
import { createMongoRepositories } from "../../src/infrastructure/database/repositories.js"

test("project access resolves roles from separate membership repositories", async () => {
  const projectId = new ObjectId()
  const organizationId = new ObjectId()
  const userId = new ObjectId()
  const project = { _id: projectId, organizationId, name: "Repository project" }
  const collectionNames = []
  const database = {
    collection(name) {
      collectionNames.push(name)
      return {
        async findOne(query) {
          if (name === "projects") return query._id.equals(projectId) ? project : null
          if (name === "organizationMemberships") return { role: "member" }
          if (name === "projectMemberships") return { role: "viewer" }
          return null
        },
      }
    },
  }
  const repositories = createMongoRepositories(database)
  const access = await repositories.projects.getAccess(projectId.toString(), userId)

  assert.equal(access.project, project)
  assert.equal(access.role, "viewer")
  assert.ok(collectionNames.includes("organizationMemberships"))
  assert.ok(collectionNames.includes("projectMemberships"))
})

test("project creation persists its editor membership through the project repository", async () => {
  const projectId = new ObjectId()
  const organizationId = new ObjectId()
  const userId = new ObjectId()
  const storedMemberships = []
  const database = {
    collection(name) {
      if (name === "projects") {
        return {
          async insertOne(project) {
            assert.equal(project.organizationId, organizationId)
            return { insertedId: projectId }
          },
          async deleteOne() { return { deletedCount: 1 } },
        }
      }
      if (name === "projectMemberships") {
        return {
          async insertOne(membership) {
            storedMemberships.push(membership)
            return { insertedId: new ObjectId() }
          },
        }
      }
      return {}
    },
  }
  const repositories = createMongoRepositories(database)

  await repositories.projects.createWithOwner(
    { organizationId, name: "New project", createdAt: new Date() },
    userId,
  )

  assert.equal(storedMemberships.length, 1)
  assert.equal(storedMemberships[0].projectId, projectId)
  assert.equal(storedMemberships[0].userId, userId)
  assert.equal(storedMemberships[0].role, "editor")
})

test("organization creation persists its owner membership", async () => {
  const organizationId = new ObjectId()
  const userId = new ObjectId()
  let ownerMembership
  const database = {
    collection(name) {
      if (name === "organizations") {
        return {
          async insertOne() {
            return { insertedId: organizationId }
          },
          async deleteOne() { return { deletedCount: 1 } },
        }
      }
      if (name === "organizationMemberships") {
        return {
          async insertOne(membership) {
            ownerMembership = membership
            return { insertedId: new ObjectId() }
          },
        }
      }
      return {}
    },
  }
  const repositories = createMongoRepositories(database)

  await repositories.organizations.createWithOwner(
    { name: "New organization", createdAt: new Date() },
    userId,
  )

  assert.equal(ownerMembership.organizationId, organizationId)
  assert.equal(ownerMembership.userId, userId)
  assert.equal(ownerMembership.role, "owner")
})

test("startup migration backfills separate memberships and normalized email idempotently", async () => {
  const orgOwnerId = new ObjectId()
  const orgMemberId = new ObjectId()
  const organizationId = new ObjectId()
  const projectCreatorId = new ObjectId()
  const projectViewerId = new ObjectId()
  const projectId = new ObjectId()
  const userId = new ObjectId()
  const organizations = [{
    _id: organizationId,
    createdBy: orgOwnerId,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    members: [
      { userId: orgOwnerId, role: "owner" },
      { userId: orgMemberId, role: "member" },
    ],
  }]
  const projects = [{
    _id: projectId,
    createdBy: projectCreatorId,
    createdAt: new Date("2026-01-02T00:00:00Z"),
    members: [{ userId: projectViewerId, role: "viewer" }],
  }]
  const users = [{ _id: userId, email: "  Person@Example.Test " }]
  const organizationMemberships = []
  const projectMemberships = []
  const createdIndexes = []

  const createCursor = (records) => ({
    async *[Symbol.asyncIterator]() {
      for (const record of records) yield record
    },
  })
  const membershipCollection = (records, foreignKey) => ({
    async updateOne(query, update, options) {
      let record = records.find((item) => (
        item[foreignKey].equals(query[foreignKey])
        && item.userId.equals(query.userId)
      ))
      if (!record && options?.upsert) {
        record = { ...update.$setOnInsert }
        records.push(record)
      }
      return { matchedCount: record ? 1 : 0 }
    },
    async createIndex(keys, options) {
      createdIndexes.push({ collection: foreignKey, keys, options })
    },
  })
  const entityCollection = (records, name) => ({
    find(query) {
      const selected = name === "users"
        ? records.filter((record) => !record.normalizedEmail)
        : records.filter((record) => Array.isArray(record.members))
      return createCursor(selected)
    },
    async updateOne(query, update) {
      const record = records.find((item) => item._id.equals(query._id))
      if (record && update.$set) Object.assign(record, update.$set)
      if (record && update.$unset) {
        for (const key of Object.keys(update.$unset)) delete record[key]
      }
      return { matchedCount: record ? 1 : 0 }
    },
    async createIndex(keys, options) {
      createdIndexes.push({ collection: name, keys, options })
    },
  })
  const database = {
    collection(name) {
      if (name === "organizations") return entityCollection(organizations, name)
      if (name === "projects") return entityCollection(projects, name)
      if (name === "users") return entityCollection(users, name)
      if (name === "organizationMemberships") {
        return membershipCollection(organizationMemberships, "organizationId")
      }
      if (name === "projectMemberships") {
        return membershipCollection(projectMemberships, "projectId")
      }
      return {
        async createIndex(keys, options) {
          createdIndexes.push({ collection: name, keys, options })
        },
      }
    },
  }

  await ensureDatabaseIndexes(database)
  await ensureDatabaseIndexes(database)

  assert.equal(organizations[0].members, undefined)
  assert.equal(projects[0].members, undefined)
  assert.equal(users[0].normalizedEmail, "person@example.test")
  assert.equal(organizationMemberships.length, 2)
  assert.equal(
    organizationMemberships.find((membership) => membership.userId.equals(orgOwnerId)).role,
    "owner",
  )
  assert.equal(projectMemberships.length, 2)
  assert.equal(
    projectMemberships.find((membership) => membership.userId.equals(projectCreatorId)).role,
    "editor",
  )
  assert.ok(createdIndexes.some((index) => (
    index.collection === "users" && index.options?.unique === true
  )))
})
