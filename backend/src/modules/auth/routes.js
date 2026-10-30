import { Router } from "express"
import { ObjectId } from "mongodb"
import {
  createAccessToken,
  createRefreshToken,
  hashPassword,
  hashRefreshToken,
  verifyPassword,
} from "./tokens.js"

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function publicUser(user) {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
  }
}

function getRefreshCookie(request) {
  const cookie = request.headers.cookie
  if (typeof cookie !== "string") return null
  const refreshCookie = cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("workspace_refresh="))
  return refreshCookie?.slice("workspace_refresh=".length) || null
}

function setRefreshCookie(response, token, { isProduction, refreshTokenTtlDays }) {
  const parts = [
    `workspace_refresh=${token}`,
    "Path=/api/auth",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${refreshTokenTtlDays * 24 * 60 * 60}`,
  ]
  if (isProduction) parts.push("Secure")
  response.set("Set-Cookie", parts.join("; "))
}

function clearRefreshCookie(response, isProduction) {
  const parts = [
    "workspace_refresh=",
    "Path=/api/auth",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ]
  if (isProduction) parts.push("Secure")
  response.set("Set-Cookie", parts.join("; "))
}

async function createSession({
  user,
  request,
  response,
  refreshSessions,
  jwtSecret,
  jwtIssuer,
  jwtAudience,
  accessTokenTtlSeconds,
  refreshTokenTtlDays,
  isProduction,
}) {
  const refreshToken = createRefreshToken()
  const now = new Date()
  await refreshSessions.create({
    userId: user._id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: new Date(now.valueOf() + refreshTokenTtlDays * 24 * 60 * 60 * 1000),
    revokedAt: null,
    createdAt: now,
    lastUsedAt: now,
    userAgent: typeof request.headers["user-agent"] === "string"
      ? request.headers["user-agent"].slice(0, 256)
      : "",
  })
  setRefreshCookie(response, refreshToken, { isProduction, refreshTokenTtlDays })
  return {
    user: publicUser(user),
    token: createAccessToken(user, jwtSecret, accessTokenTtlSeconds, {
      issuer: jwtIssuer,
      audience: jwtAudience,
    }),
    expiresIn: accessTokenTtlSeconds,
  }
}

export function createAuthRouter({
  users,
  refreshSessions,
  jwtSecret,
  jwtIssuer = "collaborative-code-workspace",
  jwtAudience = "collaborative-code-workspace-web",
  accessTokenTtlSeconds = 900,
  refreshTokenTtlDays = 30,
  isProduction = false,
}) {
  const router = Router()

  router.post("/register", async (request, response, next) => {
    const email = typeof request.body.email === "string"
      ? request.body.email.trim().toLowerCase()
      : ""
    const name = typeof request.body.name === "string" ? request.body.name.trim() : ""
    const password = request.body.password

    if (!EMAIL_PATTERN.test(email) || email.length > 254) {
      response.status(400).json({ error: "A valid email address is required" })
      return
    }
    if (name.length < 1 || name.length > 80) {
      response.status(400).json({ error: "Name must be between 1 and 80 characters" })
      return
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 256) {
      response.status(400).json({ error: "Password must be between 12 and 256 characters" })
      return
    }

    try {
      const existingUser = await users.findByEmail(email)
      if (existingUser) {
        response.status(409).json({ error: "An account with that email already exists" })
        return
      }

      const user = {
        _id: new ObjectId(),
        email,
        normalizedEmail: email,
        name,
        passwordHash: await hashPassword(password),
        createdAt: new Date(),
      }
      await users.create(user)
      const session = await createSession({
        user,
        request,
        response,
        refreshSessions,
        jwtSecret,
        jwtIssuer,
        jwtAudience,
        accessTokenTtlSeconds,
        refreshTokenTtlDays,
        isProduction,
      })
      response.status(201).json(session)
    } catch (error) {
      if (error.code === 11000) {
        response.status(409).json({ error: "An account with that email already exists" })
        return
      }
      next(error)
    }
  })

  router.post("/login", async (request, response, next) => {
    const email = typeof request.body.email === "string"
      ? request.body.email.trim().toLowerCase()
      : ""
    const password = request.body.password
    if (!EMAIL_PATTERN.test(email) || typeof password !== "string" || password.length > 256) {
      response.status(401).json({ error: "Invalid email or password" })
      return
    }

    try {
      const user = await users.findByEmail(email, { includePasswordHash: true })
      if (!user || !await verifyPassword(password, user.passwordHash)) {
        response.status(401).json({ error: "Invalid email or password" })
        return
      }

      const session = await createSession({
        user,
        request,
        response,
        refreshSessions,
        jwtSecret,
        jwtIssuer,
        jwtAudience,
        accessTokenTtlSeconds,
        refreshTokenTtlDays,
        isProduction,
      })
      response.status(200).json(session)
    } catch (error) {
      next(error)
    }
  })

  router.post("/refresh", async (request, response, next) => {
    const currentRefreshToken = getRefreshCookie(request)
    if (!currentRefreshToken || !/^[A-Za-z0-9_-]{40,60}$/.test(currentRefreshToken)) {
      clearRefreshCookie(response, isProduction)
      response.status(401).json({ error: "Authentication required" })
      return
    }

    try {
      const nextRefreshToken = createRefreshToken()
      const now = new Date()
      const sessionResult = await refreshSessions.rotate({
        tokenHash: hashRefreshToken(currentRefreshToken),
        nextTokenHash: hashRefreshToken(nextRefreshToken),
        now,
        expiresAt: new Date(now.valueOf() + refreshTokenTtlDays * 24 * 60 * 60 * 1000),
      })
      const session = sessionResult?.value ?? sessionResult
      if (!session) {
        clearRefreshCookie(response, isProduction)
        response.status(401).json({ error: "Authentication required" })
        return
      }

      const user = await users.findById(session.userId, {
        email: 1,
        normalizedEmail: 1,
        name: 1,
        createdAt: 1,
      })
      if (!user) {
        await refreshSessions.revoke(hashRefreshToken(nextRefreshToken), now)
        clearRefreshCookie(response, isProduction)
        response.status(401).json({ error: "Authentication required" })
        return
      }

      setRefreshCookie(response, nextRefreshToken, { isProduction, refreshTokenTtlDays })
      response.status(200).json({
        user: publicUser(user),
        token: createAccessToken(user, jwtSecret, accessTokenTtlSeconds, {
          issuer: jwtIssuer,
          audience: jwtAudience,
        }),
        expiresIn: accessTokenTtlSeconds,
      })
    } catch (error) {
      next(error)
    }
  })

  router.post("/logout", async (request, response, next) => {
    const refreshToken = getRefreshCookie(request)
    try {
      if (refreshToken && /^[A-Za-z0-9_-]{40,60}$/.test(refreshToken)) {
        await refreshSessions.revoke(hashRefreshToken(refreshToken), new Date())
      }
      clearRefreshCookie(response, isProduction)
      response.status(204).end()
    } catch (error) {
      next(error)
    }
  })

  return router
}
