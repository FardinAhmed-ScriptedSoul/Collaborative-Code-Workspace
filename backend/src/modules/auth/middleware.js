import { ObjectId } from "mongodb"
import { getBearerToken, verifyAccessToken } from "./tokens.js"

export function createAuthMiddleware({
  users,
  jwtSecret,
  jwtIssuer,
  jwtAudience,
}) {
  return async function authenticateRequest(request, response, next) {
    const token = getBearerToken(request.headers.authorization)
    const claims = verifyAccessToken(token, jwtSecret, {
      issuer: jwtIssuer,
      audience: jwtAudience,
    })
    if (!claims || !ObjectId.isValid(claims.sub)) {
      response.status(401).json({ error: "Authentication required" })
      return
    }

    try {
      const user = await users.findById(new ObjectId(claims.sub), {
        email: 1,
        normalizedEmail: 1,
        name: 1,
        createdAt: 1,
        isSystemAdmin: 1,
      })
      if (!user) {
        response.status(401).json({ error: "Authentication required" })
        return
      }

      request.user = user
      next()
    } catch (error) {
      next(error)
    }
  }
}
