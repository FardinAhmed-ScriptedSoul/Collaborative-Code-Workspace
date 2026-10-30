import { Router } from "express"
import { ObjectId } from "mongodb"

function hasOrganizationRole(membership, roles) {
  return membership && roles.includes(membership.role)
}

export function createOrganizationRouter({ organizations, users }) {
  const router = Router()

  router.get("/", async (request, response, next) => {
    try {
      const results = await organizations.listForUser(request.user._id)
      response.json({
        organizations: results.map((organization) => ({
          id: organization._id.toString(),
          name: organization.name,
          role: organization.role,
          createdAt: organization.createdAt,
        })),
      })
    } catch (error) {
      next(error)
    }
  })

  router.post("/", async (request, response, next) => {
    const name = typeof request.body.name === "string" ? request.body.name.trim() : ""
    if (name.length < 2 || name.length > 80) {
      response.status(400).json({ error: "Organization name must be between 2 and 80 characters" })
      return
    }

    try {
      const organization = {
        name,
        createdBy: request.user._id,
        createdAt: new Date(),
      }
      const result = await organizations.createWithOwner(organization, request.user._id)
      response.status(201).json({
        organization: {
          id: result.insertedId.toString(),
          name,
          role: "owner",
          createdAt: organization.createdAt,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.post("/:organizationId/members", async (request, response, next) => {
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
      const currentMembership = await organizations.findMembership(
        organizationIdObject,
        request.user._id,
      )
      if (!hasOrganizationRole(currentMembership, ["owner", "admin"])) {
        response.status(403).json({ error: "Organization admin permission required" })
        return
      }

      const member = await users.findByEmail(email)
      if (!member) {
        response.status(404).json({ error: "Register the invited user before adding them" })
        return
      }
      if (await organizations.findMembership(organizationIdObject, member._id)) {
        response.status(409).json({ error: "User is already an organization member" })
        return
      }

      await organizations.addMember(organizationIdObject, member._id, role)
      response.status(201).json({ member: { userId: member._id.toString(), role } })
    } catch (error) {
      next(error)
    }
  })

  return router
}
