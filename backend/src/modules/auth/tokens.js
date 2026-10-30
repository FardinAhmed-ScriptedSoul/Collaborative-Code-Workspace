import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as callbackScrypt,
  timingSafeEqual,
} from "node:crypto"
import { promisify } from "node:util"

const scrypt = promisify(callbackScrypt)

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const derivedKey = await scrypt(password, salt, 64)
  return `scrypt$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`
}

export async function verifyPassword(password, passwordHash) {
  const [algorithm, saltValue, hashValue] = passwordHash.split("$")
  if (algorithm !== "scrypt" || !saltValue || !hashValue) return false

  const salt = Buffer.from(saltValue, "base64url")
  const expectedHash = Buffer.from(hashValue, "base64url")
  const actualHash = await scrypt(password, salt, expectedHash.length)
  return actualHash.length === expectedHash.length
    && timingSafeEqual(actualHash, expectedHash)
}

function sign(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url")
}

export function createAccessToken(
  user,
  secret,
  expiresInSeconds = 900,
  { issuer = "collaborative-code-workspace", audience = "collaborative-code-workspace-web" } = {},
) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const payload = Buffer.from(JSON.stringify({
    sub: user._id.toString(),
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + expiresInSeconds,
    jti: randomBytes(16).toString("base64url"),
  })).toString("base64url")
  const content = `${header}.${payload}`
  return `${content}.${sign(content, secret)}`
}

export function verifyAccessToken(
  token,
  secret,
  { issuer = "collaborative-code-workspace", audience = "collaborative-code-workspace-web" } = {},
) {
  if (typeof token !== "string") return null

  const [headerValue, payloadValue, signature, extra] = token.split(".")
  if (!headerValue || !payloadValue || !signature || extra !== undefined) return null

  const content = `${headerValue}.${payloadValue}`
  const expectedSignature = Buffer.from(sign(content, secret))
  const actualSignature = Buffer.from(signature)
  if (expectedSignature.length !== actualSignature.length
    || !timingSafeEqual(expectedSignature, actualSignature)) {
    return null
  }

  try {
    const header = JSON.parse(Buffer.from(headerValue, "base64url").toString("utf8"))
    const payload = JSON.parse(Buffer.from(payloadValue, "base64url").toString("utf8"))
    const now = Math.floor(Date.now() / 1000)
    if (header.alg !== "HS256"
      || payload.iss !== issuer
      || payload.aud !== audience
      || typeof payload.sub !== "string"
      || typeof payload.jti !== "string"
      || !Number.isInteger(payload.iat)
      || !Number.isInteger(payload.exp)
      || payload.exp <= now) {
      return null
    }

    return payload
  } catch {
    return null
  }
}

export function createRefreshToken() {
  return randomBytes(32).toString("base64url")
}

export function hashRefreshToken(token) {
  return createHash("sha256").update(token).digest("hex")
}

export function getBearerToken(header) {
  if (typeof header !== "string") return null
  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(header)
  return match?.[1] ?? null
}
