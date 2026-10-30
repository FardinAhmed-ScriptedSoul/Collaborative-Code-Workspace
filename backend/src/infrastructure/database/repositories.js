import { ObjectId } from "mongodb"

export function createMongoRepositories(database) {
  const usersCollection = database.collection("users")
  const organizationsCollection = database.collection("organizations")
  const organizationMembershipsCollection = database.collection("organizationMemberships")
  const projectsCollection = database.collection("projects")
  const projectMembershipsCollection = database.collection("projectMemberships")
  const invitationsCollection = database.collection("invitations")
  const refreshSessionsCollection = database.collection("refreshSessions")
  const messagesCollection = database.collection("messages")
  const discussionsCollection = database.collection("discussions")
  const snapshotsCollection = database.collection("snapshots")

  const users = {
    findByEmail(normalizedEmail, { includePasswordHash = false } = {}) {
      return usersCollection.findOne(
        { normalizedEmail },
        includePasswordHash ? {} : { projection: { passwordHash: 0 } },
      )
    },
    findById(userId, projection) {
      return usersCollection.findOne(
        { _id: userId },
        projection ? { projection } : {},
      )
    },
    create(user) {
      return usersCollection.insertOne(user)
    },
  }

  const organizations = {
    findById(organizationId) {
      return organizationsCollection.findOne({ _id: organizationId })
    },
    async listForUser(userId) {
      const memberships = await organizationMembershipsCollection
        .find({ userId })
        .toArray()
      if (memberships.length === 0) return []

      const records = await organizationsCollection.find(
        { _id: { $in: memberships.map(({ organizationId }) => organizationId) } },
        { projection: { name: 1, createdAt: 1 } },
      ).toArray()
      const rolesById = new Map(
        memberships.map(({ organizationId, role }) => [organizationId.toString(), role]),
      )
      return records.map((organization) => ({
        ...organization,
        role: rolesById.get(organization._id.toString()),
      }))
    },
    async createWithOwner(organization, userId) {
      const result = await organizationsCollection.insertOne(organization)
      try {
        await organizationMembershipsCollection.insertOne({
          organizationId: result.insertedId,
          userId,
          role: "owner",
          createdAt: organization.createdAt,
        })
      } catch (error) {
        const cleanupErrors = []
        try {
          await organizationMembershipsCollection.deleteOne({
            organizationId: result.insertedId,
            userId,
          })
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
        try {
          await organizationsCollection.deleteOne({ _id: result.insertedId })
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [error, ...cleanupErrors],
            "Could not create organization owner membership and failed to remove the organization",
          )
        }
        throw error
      }
      return result
    },
    findMembership(organizationId, userId) {
      return organizationMembershipsCollection.findOne({ organizationId, userId })
    },
    async addMember(organizationId, userId, role, createdAt = new Date()) {
      return organizationMembershipsCollection.insertOne({
        organizationId,
        userId,
        role,
        createdAt,
      })
    },
    listMemberships(organizationId) {
      return organizationMembershipsCollection.find({ organizationId }).toArray()
    },
  }

  const projects = {
    findById(projectId) {
      return projectsCollection.findOne({ _id: projectId })
    },
    async listForUser(userId) {
      const [organizationMemberships, projectMemberships] = await Promise.all([
        organizationMembershipsCollection.find({
          userId,
          role: { $in: ["owner", "admin"] },
        }).toArray(),
        projectMembershipsCollection.find({ userId }).toArray(),
      ])
      const projectIds = projectMemberships.map(({ projectId }) => projectId)
      const organizationIds = organizationMemberships.map(({ organizationId }) => organizationId)
      const clauses = []
      if (projectIds.length > 0) clauses.push({ _id: { $in: projectIds } })
      if (organizationIds.length > 0) clauses.push({ organizationId: { $in: organizationIds } })
      if (clauses.length === 0) return []

      return projectsCollection.find({ $or: clauses }).toArray()
    },
    async createWithOwner(project, userId) {
      const result = await projectsCollection.insertOne(project)
      try {
        await projectMembershipsCollection.insertOne({
          projectId: result.insertedId,
          userId,
          role: "editor",
          createdAt: project.createdAt,
        })
      } catch (error) {
        const cleanupErrors = []
        try {
          await projectMembershipsCollection.deleteOne({
            projectId: result.insertedId,
            userId,
          })
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
        try {
          await projectsCollection.deleteOne({ _id: result.insertedId })
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError)
        }
        if (cleanupErrors.length > 0) {
          throw new AggregateError(
            [error, ...cleanupErrors],
            "Could not create project owner membership and failed to remove the project",
          )
        }
        throw error
      }
      return result
    },
    findMembership(projectId, userId) {
      return projectMembershipsCollection.findOne({ projectId, userId })
    },
    async setMemberRole(projectId, userId, role, createdAt = new Date()) {
      const result = await projectMembershipsCollection.updateOne(
        { projectId, userId },
        { $set: { role }, $setOnInsert: { createdAt } },
        { upsert: true },
      )
      return result
    },
    async grantMember(projectId, userId, role, createdAt = new Date()) {
      return projectMembershipsCollection.insertOne({
        projectId,
        userId,
        role,
        createdAt,
      })
    },
    async getAccess(projectId, userId) {
      if (!ObjectId.isValid(projectId)) return null
      const projectObjectId = typeof projectId === "string" ? new ObjectId(projectId) : projectId
      const project = await projectsCollection.findOne({ _id: projectObjectId })
      if (!project) return null

      const [organizationMembership, projectMembership] = await Promise.all([
        organizationMembershipsCollection.findOne({
          organizationId: project.organizationId,
          userId,
        }),
        projectMembershipsCollection.findOne({
          projectId: project._id,
          userId,
        }),
      ])
      if (["owner", "admin"].includes(organizationMembership?.role)) {
        return { project, organizationMembership, role: "editor" }
      }
      if (projectMembership) {
        return { project, organizationMembership, role: projectMembership.role }
      }
      return null
    },
  }

  const invitations = {
    create(invitation) {
      return invitationsCollection.insertOne(invitation)
    },
    consume({ tokenHash, email, now }) {
      return invitationsCollection.findOneAndDelete({
        tokenHash,
        email,
        expiresAt: { $gt: now },
      })
    },
    restore(invitation) {
      return invitationsCollection.insertOne(invitation)
    },
  }

  const refreshSessions = {
    create(session) {
      return refreshSessionsCollection.insertOne(session)
    },
    rotate({ tokenHash, nextTokenHash, now, expiresAt }) {
      return refreshSessionsCollection.findOneAndUpdate(
        {
          tokenHash,
          revokedAt: null,
          expiresAt: { $gt: now },
        },
        { $set: { tokenHash: nextTokenHash, expiresAt, lastUsedAt: now } },
        { returnDocument: "after" },
      )
    },
    revoke(tokenHash, revokedAt) {
      return refreshSessionsCollection.updateOne(
        { tokenHash, revokedAt: null },
        { $set: { revokedAt } },
      )
    },
  }

  const collaboration = {
    listMessages(projectId, { before, limit }) {
      const query = { projectId }
      if (before) query.createdAt = { $lt: before }
      return messagesCollection.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .toArray()
    },
    findMessage(projectId, messageId) {
      return messagesCollection.findOne({ _id: messageId, projectId })
    },
    insertMessage(message) {
      return messagesCollection.insertOne(message)
    },
    updateMessage(projectId, messageId, changes) {
      return messagesCollection.updateOne(
        { _id: messageId, projectId },
        { $set: changes },
      )
    },
    deleteMessage(projectId, messageId) {
      return messagesCollection.deleteOne({ _id: messageId, projectId })
    },
    listDiscussions(projectId) {
      return discussionsCollection.find({ projectId })
        .sort({ createdAt: -1 })
        .limit(100)
        .toArray()
    },
    findDiscussion(projectId, discussionId) {
      return discussionsCollection.findOne({ _id: discussionId, projectId })
    },
    insertDiscussion(discussion) {
      return discussionsCollection.insertOne(discussion)
    },
    updateDiscussion(projectId, discussionId, changes) {
      return discussionsCollection.updateOne(
        { _id: discussionId, projectId },
        { $set: changes },
      )
    },
    listSnapshots(projectId) {
      return snapshotsCollection.find({ projectId })
        .project({ code: 0 })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray()
    },
    findSnapshot(projectId, snapshotId) {
      return snapshotsCollection.findOne({ _id: snapshotId, projectId })
    },
    insertSnapshot(snapshot) {
      return snapshotsCollection.insertOne(snapshot)
    },
  }

  return { users, organizations, projects, invitations, refreshSessions, collaboration }
}
