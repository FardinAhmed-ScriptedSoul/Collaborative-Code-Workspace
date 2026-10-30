import { randomBytes } from "node:crypto"

function parsePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535")
  }
  return port
}

function parseAccessTokenTtl(value) {
  const match = /^(\d+)(s|m|h)$/.exec(value)
  if (!match) {
    throw new Error("JWT_ACCESS_TTL must be a duration such as 15m, 900s, or 1h")
  }
  const amount = Number(match[1])
  const unitSeconds = { s: 1, m: 60, h: 3600 }[match[2]]
  const seconds = amount * unitSeconds
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 3_600) {
    throw new Error("JWT_ACCESS_TTL must be between 60 seconds and 1 hour")
  }
  return seconds
}

function parseRefreshTokenTtlDays(value) {
  const days = Number(value)
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("REFRESH_TOKEN_TTL_DAYS must be an integer between 1 and 365")
  }
  return days
}

function loadConfig(environment = process.env) {
  const mongodbUri = environment.MONGODB_URI || "mongodb://localhost:27017/"
  const databaseName = environment.DB_NAME || "Orbit"
  const jwtSecret = environment.JWT_ACCESS_SECRET || (
    environment.NODE_ENV === "production"
      ? ""
      : randomBytes(32).toString("base64url")
  )
  const jwtIssuer = (environment.JWT_ISSUER || "collaborative-code-workspace").trim()
  const jwtAudience = (environment.JWT_AUDIENCE || "collaborative-code-workspace-web").trim()

  if (!mongodbUri.startsWith("mongodb://") && !mongodbUri.startsWith("mongodb+srv://")) {
    throw new Error("MONGODB_URI must use the mongodb:// or mongodb+srv:// scheme")
  }

  if (!databaseName.trim()) {
    throw new Error("DB_NAME must not be empty")
  }

  if (jwtSecret.length < 32) {
    throw new Error("JWT_ACCESS_SECRET must be at least 32 characters outside local development")
  }
  if (!jwtIssuer || !jwtAudience) {
    throw new Error("JWT_ISSUER and JWT_AUDIENCE must not be empty")
  }

  return Object.freeze({
    mongodbUri,
    databaseName: databaseName.trim(),
    port: parsePort(environment.PORT || "3000"),
    jwtSecret,
    jwtIssuer,
    jwtAudience,
    accessTokenTtlSeconds: parseAccessTokenTtl(environment.JWT_ACCESS_TTL || "15m"),
    refreshTokenTtlDays: parseRefreshTokenTtlDays(environment.REFRESH_TOKEN_TTL_DAYS || "30"),
    allowedOrigins: (environment.ALLOWED_ORIGINS || "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    isProduction: environment.NODE_ENV === "production",
    yjsPersistenceDirectory: environment.YPERSISTENCE || undefined,
  })
}

export default loadConfig
