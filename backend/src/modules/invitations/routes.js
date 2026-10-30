import { createHash, randomBytes } from "node:crypto"
import { Router } from "express"
import { ObjectId } from "mongodb"

function hashInvitationToken(token) {
  return createHash("sha256").update(token).digest("hex")
}

export function createInvitationRouter({
  invitations,
  organizations,
  projects,
  getProjectAccess,
}) {
  const router = Router()

  router.post("/organizations/:organizationId", async (request, response, next) => {
    const { organizationId } = request.params
    const email = typeof request.body.email === "string"
      ? request.body.email.trim().toLowerCase()
      : ""
    const role = request.body.role
    if (!ObjectId.isValid(organizationId)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || !["admin", "member"].includes(role)) {
      response.status(400).json({ error: "A valid email and organization role are required" })
      return
    }

    try {
      const organizationIdObject = new ObjectId(organizationId)
      const organization = await organizations.findById(organizationIdObject)
      if (!organization) {
        response.status(404).json({ error: "Organization not found" })
        return
      }
      const membership = await organizations.findMembership(
        organizationIdObject,
        request.user._id,
      )
      if (!membership || !["owner", "admin"].includes(membership.role)) {
        response.status(403).json({ error: "Organization admin permission required" })
        return
      }

      const invitation = await createInvitation({
        invitations,
        email,
        role,
        targetType: "organization",
        targetId: organization._id,
        invitedBy: request.user._id,
      })
      response.status(201).json({ invitation })
    } catch (error) {
      next(error)
    }
  })

  router.post("/projects/:projectId", async (request, response, next) => {
    const { projectId } = request.params
    const email = typeof request.body.email === "string"
      ? request.body.email.trim().toLowerCase()
      : ""
    const role = request.body.role
    if (!ObjectId.isValid(projectId)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || !["editor", "viewer"].includes(role)) {
      response.status(400).json({ error: "A valid email and project role are required" })
      return
    }

    try {
      const access = await getProjectAccess(projectId, request.user._id)
      if (!access) {
        response.status(404).json({ error: "Project not found" })
        return
      }
      const canManage = ["owner", "admin"].includes(access.organizationMembership?.role)
      if (!canManage) {
        response.status(403).json({ error: "Organization admin permission required" })
        return
      }

      const invitation = await createInvitation({
        invitations,
        email,
        role,
        targetType: "project",
        targetId: access.project._id,
        invitedBy: request.user._id,
      })
      response.status(201).json({ invitation })
    } catch (error) {
      next(error)
    }
  })

  router.post("/accept", async (request, response, next) => {
    const token = request.body.token
    if (typeof token !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) {
      response.status(400).json({ error: "A valid invitation token is required" })
      return
    }

    try {
      const invitationResult = await invitations.consume({
        tokenHash: hashInvitationToken(token),
        email: request.user.normalizedEmail,
        now: new Date(),
      })
      const invite = invitationResult?.value ?? invitationResult
      if (!invite) {
        response.status(404).json({ error: "Invitation is invalid, expired, or for another account" })
        return
      }

      try {
        if (invite.targetType === "organization") {
          if (!await organizations.findById(invite.targetId)) {
            response.status(409).json({ error: "The organization no longer exists" })
            return
          }
          if (await organizations.findMembership(invite.targetId, request.user._id)) {
            response.status(409).json({ error: "You are already an organization member" })
            return
          }
          await organizations.addMember(invite.targetId, request.user._id, invite.role)
        } else {
          if (!await projects.findById(invite.targetId)) {
            response.status(409).json({ error: "The project no longer exists" })
            return
          }
          if (await projects.findMembership(invite.targetId, request.user._id)) {
            response.status(409).json({ error: "You are already a project member" })
            return
          }
          await projects.grantMember(invite.targetId, request.user._id, invite.role)
        }
      } catch (error) {
        try {
          await invitations.restore(invite)
        } catch (restoreError) {
          throw new AggregateError(
            [error, restoreError],
            "Invitation membership grant failed and the invitation could not be restored",
          )
        }
        throw error
      }

      response.status(200).json({
        invitation: { targetType: invite.targetType, targetId: invite.targetId.toString(), role: invite.role },
      })
    } catch (error) {
      next(error)
    }
  })

  return router
}

async function createInvitation({ invitations, email, role, targetType, targetId, invitedBy }) {
  const token = randomBytes(32).toString("base64url")
  const invitation = {
    email,
    role,
    targetType,
    targetId,
    invitedBy,
    tokenHash: hashInvitationToken(token),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }
  await invitations.create(invitation)
  return {
    token,
    email,
    role,
    targetType,
    targetId: targetId.toString(),
    expiresAt: invitation.expiresAt,
  }
}
