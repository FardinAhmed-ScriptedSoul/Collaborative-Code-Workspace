import { Router } from "express"
import { ObjectId } from "mongodb"
import { canEditProject } from "./access.js"

function canManageOrganization(membership) {
  return ["owner", "admin"].includes(membership?.role)
}

export function createProjectRouter({ organizations, projects, users, getProjectAccess }) {
  const router = Router()

  router.get("/", async (request, response, next) => {
    try {
      const results = await projects.listForUser(request.user._id)
      response.json({
        projects: results.map((project) => ({
          id: project._id.toString(),
          organizationId: project.organizationId.toString(),
          name: project.name,
          createdAt: project.createdAt,
        })),
      })
    } catch (error) {
      next(error)
    }
  })

  router.post("/", async (request, response, next) => {
    const { organizationId } = request.body
    const name = typeof request.body.name === "string" ? request.body.name.trim() : ""
    if (!ObjectId.isValid(organizationId) || name.length < 2 || name.length > 100) {
      response.status(400).json({ error: "Organization ID and a project name are required" })
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
      if (!canManageOrganization(membership)) {
        response.status(403).json({ error: "Organization admin permission required" })
        return
      }

      const project = {
        organizationId: organization._id,
        name,
        createdBy: request.user._id,
        createdAt: new Date(),
      }
      const result = await projects.createWithOwner(project, request.user._id)
      response.status(201).json({
        project: {
          id: result.insertedId.toString(),
          organizationId: organization._id.toString(),
          name,
          createdAt: project.createdAt,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.post("/:projectId/members", async (request, response, next) => {
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
      if (!canManageOrganization(access.organizationMembership)) {
        response.status(403).json({ error: "Organization admin permission required" })
        return
      }

      const user = await users.findByEmail(email)
      if (!user) {
        response.status(404).json({ error: "Register the invited user before adding them" })
        return
      }
      await projects.setMemberRole(access.project._id, user._id, role)
      response.status(200).json({ member: { userId: user._id.toString(), role } })
    } catch (error) {
      next(error)
    }
  })

  router.get("/:projectId", async (request, response, next) => {
    try {
      const access = await getProjectAccess(request.params.projectId, request.user._id)
      if (!access) {
        response.status(404).json({ error: "Project not found" })
        return
      }
      response.json({
        project: {
          id: access.project._id.toString(),
          organizationId: access.project.organizationId.toString(),
          name: access.project.name,
          role: access.role,
          canManageMembers: canManageOrganization(access.organizationMembership),
          createdAt: access.project.createdAt,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.post("/:projectId/edit-check", async (request, response, next) => {
    try {
      const access = await getProjectAccess(request.params.projectId, request.user._id)
      if (!access) {
        response.status(404).json({ error: "Project not found" })
        return
      }
      if (!canEditProject(access)) {
        response.status(403).json({ error: "Project editor permission required" })
        return
      }
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  return router
}
