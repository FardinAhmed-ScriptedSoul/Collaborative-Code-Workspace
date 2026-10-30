let accessToken = null
let refreshRequest = null
const accessTokenListeners = new Set()

export function getAccessToken() {
  return accessToken
}

export function setAccessToken(token) {
  accessToken = token || null
  for (const listener of accessTokenListeners) listener()
}

export function subscribeAccessToken(listener) {
  accessTokenListeners.add(listener)
  return () => accessTokenListeners.delete(listener)
}

async function readResponse(response) {
  if (response.status === 204) return null
  return response.json().catch(() => ({}))
}

async function fetchWithToken(path, options, token) {
  const headers = new Headers(options.headers)
  if (token) headers.set("Authorization", `Bearer ${token}`)
  else headers.delete("Authorization")
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json")
  }
  return fetch(path, { ...options, headers, credentials: "include" })
}

export async function refreshAccessToken() {
  if (!refreshRequest) {
    refreshRequest = fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
    }).then(async (response) => {
      const result = await readResponse(response)
      if (!response.ok) {
        if (response.status === 401) setAccessToken(null)
        throw new Error(result?.error || `Request failed with HTTP ${response.status}`)
      }
      setAccessToken(result.token)
      return result
    }).finally(() => {
      refreshRequest = null
    })
  }
  return refreshRequest
}

export async function apiRequest(path, { token, ...options } = {}) {
  const currentToken = accessToken || token || null
  let response = await fetchWithToken(path, options, currentToken)
  if (response.status === 401
    && currentToken
    && path !== "/api/auth/refresh"
    && path !== "/api/auth/logout") {
    const updatedToken = accessToken
    const nextToken = updatedToken && updatedToken !== currentToken
      ? updatedToken
      : (await refreshAccessToken()).token
    response = await fetchWithToken(path, options, nextToken)
  }

  const result = await readResponse(response)
  if (!response.ok) {
    throw new Error(result?.error || `Request failed with HTTP ${response.status}`)
  }
  return result
}
