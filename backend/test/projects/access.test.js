import assert from "node:assert/strict"
import test from "node:test"
import { ObjectId } from "mongodb"
import { createMongoRepositories } from "../../src/infrastructure/database/repositories.js"
import { canEditProject } from "../../src/modules/projects/access.js"

function createDatabase({ memberRole, projectRole, exists = true }) {
  const userId = new ObjectId()
  const project = {
    _id: new ObjectId(),
    organizationId: new ObjectId(),
  }
  const collections = {
    projects: {
      async findOne() {
        return exists ? project : null
      },
    },
    organizationMemberships: {
      async findOne() {
        return memberRole ? { role: memberRole } : null
      },
    },
    projectMemberships: {
      async findOne() {
        return projectRole ? { role: projectRole } : null
      },
    },
  }
  return {
    userId,
    project,
    collection(name) {
      return collections[name] ?? {}
    },
  }
}

test("organization admins inherit editor access", async () => {
  const database = createDatabase({ memberRole: "admin" })
  const access = await createMongoRepositories(database).projects.getAccess(
    database.project._id.toString(),
    database.userId,
  )

  assert.equal(access.role, "editor")
  assert.equal(canEditProject(access), true)
})

test("regular organization members need explicit project membership", async () => {
  const database = createDatabase({ memberRole: "member" })
  const access = await createMongoRepositories(database).projects.getAccess(
    database.project._id.toString(),
    database.userId,
  )

  assert.equal(access, null)
})

test("explicit project roles determine viewer and editor access", async () => {
  const viewerDatabase = createDatabase({ memberRole: "member", projectRole: "viewer" })
  const viewer = await createMongoRepositories(viewerDatabase).projects.getAccess(
    viewerDatabase.project._id.toString(),
    viewerDatabase.userId,
  )
  assert.equal(viewer.role, "viewer")
  assert.equal(canEditProject(viewer), false)

  const editorDatabase = createDatabase({ memberRole: "member", projectRole: "editor" })
  const editor = await createMongoRepositories(editorDatabase).projects.getAccess(
    editorDatabase.project._id.toString(),
    editorDatabase.userId,
  )
  assert.equal(editor.role, "editor")
  assert.equal(canEditProject(editor), true)
})

test("does not grant access to missing projects or malformed IDs", async () => {
  const database = createDatabase({ exists: false })
  const { projects } = createMongoRepositories(database)
  assert.equal(await projects.getAccess("bad-id", database.userId), null)
  assert.equal(await projects.getAccess(new ObjectId().toString(), database.userId), null)
})
