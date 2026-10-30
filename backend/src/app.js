import { randomUUID } from "node:crypto"
import express from "express"
import { createAuthMiddleware } from "./modules/auth/middleware.js"
import { createAuthRouter } from "./modules/auth/routes.js"
import { createOrganizationRouter } from "./modules/organizations/routes.js"
import { createInvitationRouter } from "./modules/invitations/routes.js"
import { createProjectRouter } from "./modules/projects/routes.js"
import { createCollaborationRouter } from "./modules/collaboration/routes.js"
import { createProjectAccessService } from "./modules/projects/access.js"
import { createMongoRepositories } from "./infrastructure/database/repositories.js"

function createRateLimiter({ limit, windowMs }) {
  const requests = new Map()
  return function rateLimit(request, response, next) {
    const now = Date.now()
    const key = request.ip
    const current = requests.get(key)
    if (!current || current.resetAt <= now) {
      requests.set(key, { count: 1, resetAt: now + windowMs })
      next()
      return
    }

    current.count += 1
    if (current.count > limit) {
      response.set("Retry-After", Math.ceil((current.resetAt - now) / 1000))
      response.status(429).json({ error: "Too many requests; try again later" })
      return
    }
    next()
  }
}

function createRequestMetrics() {
  const counts = new Map()
  return {
    record(method, path, status) {
      const key = `${method} ${path} ${Math.floor(status / 100)}xx`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    },
    snapshot() {
      return Object.fromEntries(counts)
    },
  }
}

function createApp({
  database,
  jwtSecret,
  io,
  repositories: injectedRepositories,
  jwtIssuer = "collaborative-code-workspace",
  jwtAudience = "collaborative-code-workspace-web",
  accessTokenTtlSeconds = 900,
  refreshTokenTtlDays = 30,
  allowedOrigins = ["http://localhost:5173"],
  isProduction = false,
}) {
  const app = express()
  const repositories = injectedRepositories ?? createMongoRepositories(database)
  const getProjectAccess = createProjectAccessService(repositories.projects)
  const metrics = createRequestMetrics()
  const authenticate = createAuthMiddleware({
    users: repositories.users,
    jwtSecret,
    jwtIssuer,
    jwtAudience,
  })
  const authRateLimit = createRateLimiter({ limit: 10, windowMs: 60_000 })
  const invitationRateLimit = createRateLimiter({ limit: 20, windowMs: 60_000 })

  app.disable("x-powered-by")
  app.use((request, response, next) => {
    request.requestId = request.headers["x-request-id"]?.slice(0, 100) || randomUUID()
    response.set("X-Request-Id", request.requestId)
    next()
  })
  app.use((request, response, next) => {
    const origin = request.headers.origin
    if (origin && allowedOrigins.includes(origin)) {
      response.set("Access-Control-Allow-Origin", origin)
      response.set("Vary", "Origin")
      response.set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-Id")
      response.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
      response.set("Access-Control-Allow-Credentials", "true")
    }
    if (request.method === "OPTIONS") {
      response.status(204).end()
      return
    }
    next()
  })
  app.use(express.json({ limit: "2mb" }))
  app.use((request, response, next) => {
    response.on("finish", () => {
      metrics.record(request.method, request.path, response.statusCode)
      console.info(JSON.stringify({
        level: "info",
        message: "http_request",
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        statusCode: response.statusCode,
      }))
    })
    next()
  })

  app.get("/", (_request, response) => {
    response.status(200).json({ message: "Collaborative Code Workspace API", success: true })
  })
  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" })
  })
  app.get("/health/ready", async (_request, response) => {
    try {
      await database.command({ ping: 1 })
      response.status(200).json({ status: "ready", database: "ok" })
    } catch (error) {
      console.error(JSON.stringify({ level: "error", message: "database_readiness_failed" }), error)
      response.status(503).json({ status: "not_ready", database: "unavailable" })
    }
  })
  app.get("/metrics", authenticate, (request, response) => {
    const isAdmin = request.user.isSystemAdmin === true
    if (!isAdmin) {
      response.status(403).json({ error: "Metrics access is restricted" })
      return
    }
    response.json({ requests: metrics.snapshot() })
  })

  app.use("/api/auth", authRateLimit, createAuthRouter({
    users: repositories.users,
    refreshSessions: repositories.refreshSessions,
    jwtSecret,
    jwtIssuer,
    jwtAudience,
    accessTokenTtlSeconds,
    refreshTokenTtlDays,
    isProduction,
  }))
  app.get("/api/auth/me", authenticate, (request, response) => {
    response.json({
      user: {
        id: request.user._id.toString(),
        email: request.user.email,
        name: request.user.name,
        createdAt: request.user.createdAt,
      },
    })
  })
  app.use("/api/organizations", authenticate, createOrganizationRouter({
    organizations: repositories.organizations,
    users: repositories.users,
  }))
  app.use("/api/invitations", authenticate, invitationRateLimit, createInvitationRouter({
    invitations: repositories.invitations,
    organizations: repositories.organizations,
    projects: repositories.projects,
    getProjectAccess,
  }))
  app.use("/api/projects", authenticate, createProjectRouter({
    organizations: repositories.organizations,
    projects: repositories.projects,
    users: repositories.users,
    getProjectAccess,
  }))
  app.use("/api/projects", authenticate, createCollaborationRouter({
    collaboration: repositories.collaboration,
    getProjectAccess,
    io,
  }))

  app.use((request, response) => {
    response.status(404).json({ error: "Not found", requestId: request.requestId })
  })
  app.use((error, request, response, _next) => {
    console.error(JSON.stringify({
      level: "error",
      message: "request_failed",
      requestId: request.requestId,
      error: error.message,
    }))
    const statusCode = error.status === 413 ? 413 : error.status === 400 ? 400 : 500
    response.status(statusCode).json({
      error: statusCode === 413
        ? "Request body is too large"
        : statusCode === 400
          ? "Invalid JSON request body"
          : isProduction ? "Internal server error" : error.message,
      requestId: request.requestId,
    })
  })

  return app
}

export default createApp
