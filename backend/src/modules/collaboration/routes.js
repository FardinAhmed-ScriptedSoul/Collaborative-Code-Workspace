import { Router } from "express"
import { ObjectId } from "mongodb"
import { canEditProject } from "../projects/access.js"

const MAX_MESSAGE_LENGTH = 4000
const MAX_DISCUSSION_LENGTH = 2000
const MAX_SNAPSHOT_SIZE = 1_000_000

function isValidProjectId(projectId) {
  return ObjectId.isValid(projectId)
}

function toPublicMessage(message) {
  return {
    id: message._id.toString(),
    projectId: message.projectId.toString(),
    author: message.author,
    body: message.body,
    createdAt: message.createdAt,
  }
}

function toPublicDiscussion(discussion) {
  return {
    id: discussion._id.toString(),
    projectId: discussion.projectId.toString(),
    author: discussion.author,
    anchor: discussion.anchor,
    body: discussion.body,
    status: discussion.status,
    createdAt: discussion.createdAt,
    updatedAt: discussion.updatedAt,
  }
}

export function createCollaborationRouter({ collaboration, getProjectAccess, io }) {
  const router = Router()

  router.get("/:projectId/messages", async (request, response, next) => {
    const { projectId } = request.params
    const limit = Math.min(Number(request.query.limit) || 50, 100)
    if (!isValidProjectId(projectId) || !Number.isInteger(limit) || limit < 1) {
      response.status(400).json({ error: "Invalid project ID or page size" })
      return
    }

    try {
      const access = await getProjectAccess(projectId, request.user._id)
      if (!access) {
        response.status(404).json({ error: "Project not found" })
        return
      }

      let before
      if (request.query.before) {
        before = new Date(request.query.before)
        if (Number.isNaN(before.valueOf())) {
          response.status(400).json({ error: "Invalid before timestamp" })
          return
        }
      }
      const results = await collaboration.listMessages(
        access.project._id,
        { before, limit: limit + 1 },
      )
      const hasMore = results.length > limit
      const page = results.slice(0, limit).reverse().map(toPublicMessage)
      response.json({
        messages: page,
        hasMore,
        nextBefore: hasMore ? page[0].createdAt : null,
      })
    } catch (error) {
      next(error)
    }
  })

  router.post("/:projectId/messages", async (request, response, next) => {
    const body = typeof request.body.body === "string" ? request.body.body.trim() : ""
    if (!isValidProjectId(request.params.projectId)
      || body.length < 1 || body.length > MAX_MESSAGE_LENGTH) {
      response.status(400).json({ error: `Message must be between 1 and ${MAX_MESSAGE_LENGTH} characters` })
      return
    }

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

      const message = {
        _id: new ObjectId(),
        projectId: access.project._id,
        author: { id: request.user._id.toString(), name: request.user.name },
        body,
        createdAt: new Date(),
      }
      await collaboration.insertMessage(message)
      io?.to(`project:${access.project._id}`).emit("chat:new", toPublicMessage(message))
      response.status(201).json({ message: toPublicMessage(message) })
    } catch (error) {
      next(error)
    }
  })

  router.patch("/:projectId/messages/:messageId", async (request, response, next) => {
    const body = typeof request.body.body === "string" ? request.body.body.trim() : ""
    if (!isValidProjectId(request.params.projectId)
      || !isValidProjectId(request.params.messageId)
      || body.length < 1 || body.length > MAX_MESSAGE_LENGTH) {
      response.status(400).json({ error: `Message must be between 1 and ${MAX_MESSAGE_LENGTH} characters` })
      return
    }

    try {
      const access = await getProjectAccess(request.params.projectId, request.user._id)
      if (!access) {
        response.status(404).json({ error: "Project not found" })
        return
      }
      const messageId = new ObjectId(request.params.messageId)
      const message = await collaboration.findMessage(access.project._id, messageId)
      if (!message) {
        response.status(404).json({ error: "Message not found" })
        return
      }
      if (!canEditProject(access)) {
        response.status(403).json({ error: "Project editor permission required" })
        return
      }

      const updatedAt = new Date()
      await collaboration.updateMessage(
        access.project._id,
        messageId,
        { body, updatedAt },
      )
      const updatedMessage = { ...message, body, updatedAt }
      io?.to(`project:${access.project._id}`).emit("chat:updated", toPublicMessage(updatedMessage))
      response.json({ message: toPublicMessage(updatedMessage) })
    } catch (error) {
      next(error)
    }
  })

  router.delete("/:projectId/messages/:messageId", async (request, response, next) => {
    if (!isValidProjectId(request.params.projectId)
      || !isValidProjectId(request.params.messageId)) {
      response.status(400).json({ error: "Invalid project or message ID" })
      return
    }

    try {
      const access = await getProjectAccess(request.params.projectId, request.user._id)
      if (!access) {
        response.status(404).json({ error: "Project not found" })
        return
      }
      const messageId = new ObjectId(request.params.messageId)
      const message = await collaboration.findMessage(access.project._id, messageId)
      if (!message) {
        response.status(404).json({ error: "Message not found" })
        return
      }
      if (!canEditProject(access)) {
        response.status(403).json({ error: "Project editor permission required" })
        return
      }

      await collaboration.deleteMessage(access.project._id, messageId)
      io?.to(`project:${access.project._id}`).emit("chat:deleted", {
        projectId: access.project._id.toString(),
        messageId: messageId.toString(),
      })
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  router.get("/:projectId/discussions", async (request, response, next) => {
    if (!isValidProjectId(request.params.projectId)) {
      response.status(400).json({ error: "Invalid project ID" })
      return
    }

    try {
      const access = await getProjectAccess(request.params.projectId, request.user._id)
      if (!access) {
        response.status(404).json({ error: "Project not found" })
        return
      }
      const results = await collaboration.listDiscussions(access.project._id)
      response.json({ discussions: results.map(toPublicDiscussion) })
    } catch (error) {
      next(error)
    }
  })

  router.post("/:projectId/discussions", async (request, response, next) => {
    const { startLine, endLine, selectedText } = request.body
    const body = typeof request.body.body === "string" ? request.body.body.trim() : ""
    if (!isValidProjectId(request.params.projectId)
      || !Number.isInteger(startLine) || startLine < 1
      || !Number.isInteger(endLine) || endLine < startLine
      || typeof selectedText !== "string" || selectedText.length > 10_000
      || body.length < 1 || body.length > MAX_DISCUSSION_LENGTH) {
      response.status(400).json({ error: "A valid code range and discussion body are required" })
      return
    }

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

      const discussion = {
        _id: new ObjectId(),
        projectId: access.project._id,
        author: { id: request.user._id.toString(), name: request.user.name },
        anchor: { startLine, endLine, selectedText },
        body,
        status: "open",
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      await collaboration.insertDiscussion(discussion)
      const publicDiscussion = toPublicDiscussion(discussion)
      io?.to(`project:${access.project._id}`).emit("discussion:new", publicDiscussion)
      response.status(201).json({ discussion: publicDiscussion })
    } catch (error) {
      next(error)
    }
  })

  router.patch("/:projectId/discussions/:discussionId", async (request, response, next) => {
    if (!isValidProjectId(request.params.projectId)
      || !isValidProjectId(request.params.discussionId)
      || !["open", "resolved"].includes(request.body.status)) {
      response.status(400).json({ error: "A valid discussion status is required" })
      return
    }

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
      const discussionId = new ObjectId(request.params.discussionId)
      const discussion = await collaboration.findDiscussion(access.project._id, discussionId)
      if (!discussion) {
        response.status(404).json({ error: "Discussion not found" })
        return
      }
      const updatedAt = new Date()
      await collaboration.updateDiscussion(
        access.project._id,
        discussionId,
        { status: request.body.status, updatedAt },
      )
      const updatedDiscussion = toPublicDiscussion({
        ...discussion,
        status: request.body.status,
        updatedAt,
      })
      io?.to(`project:${access.project._id}`).emit("discussion:updated", updatedDiscussion)
      response.json({ discussion: updatedDiscussion })
    } catch (error) {
      next(error)
    }
  })

  router.get("/:projectId/snapshots", async (request, response, next) => {
    if (!isValidProjectId(request.params.projectId)) {
      response.status(400).json({ error: "Invalid project ID" })
      return
    }

    try {
      const access = await getProjectAccess(request.params.projectId, request.user._id)
      if (!access) {
        response.status(404).json({ error: "Project not found" })
        return
      }
      const results = await collaboration.listSnapshots(access.project._id)
      response.json({ snapshots: results })
    } catch (error) {
      next(error)
    }
  })

  router.post("/:projectId/snapshots", async (request, response, next) => {
    const name = typeof request.body.name === "string" ? request.body.name.trim() : ""
    const code = request.body.code
    if (!isValidProjectId(request.params.projectId)
      || name.length < 1 || name.length > 100
      || typeof code !== "string" || Buffer.byteLength(code, "utf8") > MAX_SNAPSHOT_SIZE) {
      response.status(400).json({ error: "Snapshot name and code are required; code must be under 1 MB" })
      return
    }

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

      const snapshot = {
        _id: new ObjectId(),
        projectId: access.project._id,
        name,
        code,
        createdBy: { id: request.user._id.toString(), name: request.user.name },
        createdAt: new Date(),
      }
      await collaboration.insertSnapshot(snapshot)
      response.status(201).json({
        snapshot: {
          id: snapshot._id.toString(),
          projectId: snapshot.projectId.toString(),
          name: snapshot.name,
          createdBy: snapshot.createdBy,
          createdAt: snapshot.createdAt,
        },
      })
    } catch (error) {
      next(error)
    }
  })

  router.get("/:projectId/snapshots/:snapshotId", async (request, response, next) => {
    if (!isValidProjectId(request.params.projectId)
      || !isValidProjectId(request.params.snapshotId)) {
      response.status(400).json({ error: "Invalid project or snapshot ID" })
      return
    }

    try {
      const access = await getProjectAccess(request.params.projectId, request.user._id)
      if (!access) {
        response.status(404).json({ error: "Project not found" })
        return
      }
      const snapshot = await collaboration.findSnapshot(
        access.project._id,
        new ObjectId(request.params.snapshotId),
      )
      if (!snapshot) {
        response.status(404).json({ error: "Snapshot not found" })
        return
      }
      response.json({ snapshot: { ...snapshot, id: snapshot._id.toString() } })
    } catch (error) {
      next(error)
    }
  })

  return router
}
