import { Server } from "socket.io"
import { ObjectId } from "mongodb"
import { YSocketIO } from "y-socket.io/dist/server"
import { verifyAccessToken } from "../modules/auth/tokens.js"
import { canEditProject } from "../modules/projects/access.js"

const collaborationServers = new WeakMap()
const MAX_CHAT_MESSAGE_LENGTH = 4000

function getAuthenticatedUser(users, jwtSecret, token, jwtIssuer, jwtAudience) {
  const claims = verifyAccessToken(token, jwtSecret, {
    issuer: jwtIssuer,
    audience: jwtAudience,
  })
  if (!claims || !ObjectId.isValid(claims.sub)) return null
  return users.findById(new ObjectId(claims.sub), {
    email: 1,
    normalizedEmail: 1,
    name: 1,
  })
}

function createSignalRelay(io, getProjectAccess) {
  io.on("connection", (socket) => {
    socket.data.projectRooms = new Set()
    socket.on("disconnect", () => {
      for (const room of socket.data.projectRooms) {
        socket.to(room).emit("webrtc:peer-left", { socketId: socket.id })
      }
    })

    socket.data.chatSentAt = []
    socket.on("chat:send", async ({ projectId, body } = {}, acknowledge = () => {}) => {
      try {
        const normalizedBody = typeof body === "string" ? body.trim() : ""
        if (!ObjectId.isValid(projectId)
          || normalizedBody.length < 1
          || normalizedBody.length > MAX_CHAT_MESSAGE_LENGTH) {
          acknowledge({ error: "Message is invalid" })
          return
        }

        const room = `project:${projectId}`
        if (!socket.data.projectRooms.has(room)) {
          acknowledge({ error: "Join the project before sending messages" })
          return
        }
        const access = await getProjectAccess(projectId, socket.data.user._id)
        if (!access) {
          acknowledge({ error: "Project access denied" })
          return
        }
        if (!canEditProject(access)) {
          acknowledge({ error: "Project editor permission required" })
          return
        }

        const now = Date.now()
        socket.data.chatSentAt = socket.data.chatSentAt.filter((sentAt) => now - sentAt < 60_000)
        if (socket.data.chatSentAt.length >= 30) {
          acknowledge({ error: "Chat rate limit exceeded; try again shortly" })
          return
        }

        const message = {
          _id: new ObjectId(),
          projectId: access.project._id,
          author: {
            id: socket.data.user._id.toString(),
            name: socket.data.user.name,
          },
          body: normalizedBody,
          createdAt: new Date(),
        }
        await io.repositories.collaboration.insertMessage(message)
        socket.data.chatSentAt.push(now)
        const publicMessage = {
          id: message._id.toString(),
          projectId: message.projectId.toString(),
          author: message.author,
          body: message.body,
          createdAt: message.createdAt,
        }
        io.to(room).emit("chat:new", publicMessage)
        acknowledge({ message: publicMessage })
      } catch (error) {
        console.error(JSON.stringify({
          level: "error",
          message: "chat_send_failed",
          projectId,
          error: error.message,
        }))
        acknowledge({ error: "Could not send message" })
      }
    })

    socket.on("project:join", async ({ projectId } = {}, acknowledge = () => {}) => {
      try {
        const access = await getProjectAccess(projectId, socket.data.user._id)
        if (!access) {
          acknowledge({ error: "Project not found or access denied" })
          return
        }

        const room = `project:${access.project._id}`
        await socket.join(room)
        socket.data.projectRooms.add(room)
        const peers = await io.in(room).fetchSockets()
        acknowledge({
          project: {
            id: access.project._id.toString(),
            name: access.project.name,
            role: access.role,
          },
          peers: peers
            .filter((peer) => peer.id !== socket.id)
            .map((peer) => ({ socketId: peer.id, name: peer.data.user.name })),
        })
        socket.to(room).emit("webrtc:peer-joined", {
          socketId: socket.id,
          name: socket.data.user.name,
        })
      } catch (error) {
        console.error(JSON.stringify({
          level: "error",
          message: "project_join_failed",
          projectId,
          error: error.message,
        }))
        acknowledge({ error: "Could not join project" })
      }
    })

    socket.on("webrtc:signal", (signal = {}) => {
      const { projectId, targetSocketId, description, candidate } = signal
      if (!ObjectId.isValid(projectId) || typeof targetSocketId !== "string") return
      const room = `project:${projectId}`
      if (!socket.data.projectRooms.has(room)) return

      const payload = description ?? candidate
      if (!payload || Buffer.byteLength(JSON.stringify(payload), "utf8") > 128_000) return
      const target = io.sockets.sockets.get(targetSocketId)
      if (!target || !target.data.projectRooms.has(room)) return
      target.emit("webrtc:signal", {
        projectId,
        fromSocketId: socket.id,
        description,
        candidate,
      })
    })
  })
}

function attachYjsProjectAccess(
  io,
  users,
  getProjectAccess,
  jwtSecret,
  jwtIssuer,
  jwtAudience,
) {
  const namespaces = io.of(/^\/yjs\|.*$/)
  namespaces.use(async (socket, next) => {
    try {
      const projectId = socket.nsp.name.replace(/^\/yjs\|/, "")
      const user = await getAuthenticatedUser(
        users,
        jwtSecret,
        socket.handshake.auth?.token,
        jwtIssuer,
        jwtAudience,
      )
      if (!user || socket.handshake.auth?.projectId !== projectId) {
        next(new Error("Authentication required"))
        return
      }

      const access = await getProjectAccess(projectId, user._id)
      if (!access) {
        next(new Error("Project access denied"))
        return
      }
      socket.data.projectRole = access.role
      socket.use(([event], nextPacket) => {
        if (event === "sync-update" && !canEditProject(access)) {
          nextPacket(new Error("Project editor permission required"))
          return
        }
        nextPacket()
      })
      next()
    } catch (error) {
      next(error)
    }
  })
}

function attachCollaborationServer(httpServer, {
  repositories,
  getProjectAccess,
  jwtSecret,
  jwtIssuer = "collaborative-code-workspace",
  jwtAudience = "collaborative-code-workspace-web",
  yjsPersistenceDirectory,
  allowedOrigins,
} = {}) {
  const io = new Server(httpServer, {
    cors: {
      origin: allowedOrigins ?? [],
      methods: ["GET", "POST"],
    },
    maxHttpBufferSize: 128_000,
  })

  if (repositories && getProjectAccess && jwtSecret) {
    io.repositories = repositories
    io.use(async (socket, next) => {
      try {
        const user = await getAuthenticatedUser(
          repositories.users,
          jwtSecret,
          socket.handshake.auth?.token,
          jwtIssuer,
          jwtAudience,
        )
        if (!user) {
          next(new Error("Authentication required"))
          return
        }
        socket.data.user = user
        next()
      } catch (error) {
        next(error)
      }
    })
    createSignalRelay(io, getProjectAccess)
  }

  const ySocketIO = new YSocketIO(io, {
    levelPersistenceDir: yjsPersistenceDirectory,
    authenticate: async (handshake) => {
      if (!repositories || !getProjectAccess || !jwtSecret) return false
      const projectId = handshake.auth?.projectId
      if (typeof projectId !== "string"
        || handshake.auth?.token === undefined) {
        return false
      }

      const user = await getAuthenticatedUser(
        repositories.users,
        jwtSecret,
        handshake.auth.token,
        jwtIssuer,
        jwtAudience,
      )
      if (!user) return false
      const access = await getProjectAccess(projectId, user._id)
      return Boolean(access)
    },
  })
  ySocketIO.initialize()
  if (repositories && getProjectAccess && jwtSecret) {
    attachYjsProjectAccess(
      io,
      repositories.users,
      getProjectAccess,
      jwtSecret,
      jwtIssuer,
      jwtAudience,
    )
  }
  collaborationServers.set(io, ySocketIO)

  return io
}

export async function closeCollaborationServer(io) {
  const ySocketIO = collaborationServers.get(io)

  try {
    await new Promise((resolve, reject) => {
      io.close((error) => {
        if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
          reject(error)
          return
        }

        resolve()
      })
    })
  } finally {
    if (ySocketIO) {
      await Promise.all(Array.from(ySocketIO.documents.values(), (document) => document.destroy()))
      collaborationServers.delete(io)
    }
  }
}

export default attachCollaborationServer
