async function migrateEmbeddedMemberships(database) {
  const organizations = database.collection("organizations")
  const organizationMemberships = database.collection("organizationMemberships")
  const organizationCursor = organizations.find({ members: { $type: "array" } })
  for await (const organization of organizationCursor) {
    for (const member of organization.members ?? []) {
      if (!member.userId) {
        throw new Error(`Organization ${organization._id} has a member without a user ID`)
      }
      await organizationMemberships.updateOne(
        { organizationId: organization._id, userId: member.userId },
        {
          $setOnInsert: {
            organizationId: organization._id,
            userId: member.userId,
            role: member.role,
            createdAt: member.addedAt ?? organization.createdAt ?? new Date(),
          },
        },
        { upsert: true },
      )
    }
    if (organization.createdBy) {
      await organizationMemberships.updateOne(
        { organizationId: organization._id, userId: organization.createdBy },
        {
          $setOnInsert: {
            organizationId: organization._id,
            userId: organization.createdBy,
            role: "owner",
            createdAt: organization.createdAt ?? new Date(),
          },
        },
        { upsert: true },
      )
    }
    await organizations.updateOne(
      { _id: organization._id },
      { $unset: { members: "" } },
    )
  }

  const projects = database.collection("projects")
  const projectMemberships = database.collection("projectMemberships")
  const projectCursor = projects.find({ members: { $type: "array" } })
  for await (const project of projectCursor) {
    for (const member of project.members ?? []) {
      if (!member.userId) {
        throw new Error(`Project ${project._id} has a member without a user ID`)
      }
      await projectMemberships.updateOne(
        { projectId: project._id, userId: member.userId },
        {
          $setOnInsert: {
            projectId: project._id,
            userId: member.userId,
            role: member.role,
            createdAt: member.addedAt ?? project.createdAt ?? new Date(),
          },
        },
        { upsert: true },
      )
    }
    if (project.createdBy) {
      await projectMemberships.updateOne(
        { projectId: project._id, userId: project.createdBy },
        {
          $setOnInsert: {
            projectId: project._id,
            userId: project.createdBy,
            role: "editor",
            createdAt: project.createdAt ?? new Date(),
          },
        },
        { upsert: true },
      )
    }
    await projects.updateOne(
      { _id: project._id },
      { $unset: { members: "" } },
    )
  }
}

async function backfillNormalizedEmails(database) {
  const users = database.collection("users")
  const cursor = users.find({ normalizedEmail: { $exists: false } }, {
    projection: { _id: 1, email: 1 },
  })
  for await (const user of cursor) {
    if (typeof user.email !== "string" || !user.email.trim()) {
      throw new Error(`User ${user._id} has no valid email address`)
    }
    await users.updateOne(
      { _id: user._id, normalizedEmail: { $exists: false } },
      { $set: { normalizedEmail: user.email.trim().toLowerCase() } },
    )
  }
}

export async function ensureDatabaseIndexes(database) {
  await migrateEmbeddedMemberships(database)
  await backfillNormalizedEmails(database)

  await Promise.all([
    database.collection("users").createIndex({ normalizedEmail: 1 }, { unique: true }),
    database.collection("organizationMemberships").createIndex(
      { organizationId: 1, userId: 1 },
      { unique: true },
    ),
    database.collection("organizationMemberships").createIndex({ userId: 1, role: 1 }),
    database.collection("projects").createIndex({ organizationId: 1 }),
    database.collection("projectMemberships").createIndex(
      { projectId: 1, userId: 1 },
      { unique: true },
    ),
    database.collection("projectMemberships").createIndex({ userId: 1, projectId: 1 }),
    database.collection("messages").createIndex({ projectId: 1, createdAt: -1, _id: -1 }),
    database.collection("discussions").createIndex({ projectId: 1, createdAt: -1 }),
    database.collection("snapshots").createIndex({ projectId: 1, createdAt: -1 }),
    database.collection("invitations").createIndex({ tokenHash: 1 }, { unique: true }),
    database.collection("invitations").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    database.collection("refreshSessions").createIndex({ tokenHash: 1 }, { unique: true }),
    database.collection("refreshSessions").createIndex(
      { userId: 1, revokedAt: 1, expiresAt: 1 },
    ),
    database.collection("refreshSessions").createIndex(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    ),
  ])
}
