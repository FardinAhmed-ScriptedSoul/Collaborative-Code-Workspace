import "./App.css"
import { useEffect, useState, useSyncExternalStore } from "react"
import AuthPanel from "../features/auth/AuthPanel.jsx"
import { fetchBackendHealth } from "../features/collaboration/backendHealth.js"
import Workspace from "../features/workspace/Workspace.jsx"
import {
  apiRequest,
  getAccessToken,
  refreshAccessToken,
  setAccessToken,
  subscribeAccessToken,
} from "../shared/api.js"

function App() {
  const token = useSyncExternalStore(subscribeAccessToken, getAccessToken, () => null)
  const [user, setUser] = useState(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [accessTokenTtlSeconds, setAccessTokenTtlSeconds] = useState(0)
  const [backendStatus, setBackendStatus] = useState("checking")
  const [sessionError, setSessionError] = useState("")

  useEffect(() => {
    let active = true
    refreshAccessToken()
      .then(({ user: authenticatedUser, expiresIn }) => {
        if (!active) return
        setSessionError("")
        setUser(authenticatedUser)
        setAccessTokenTtlSeconds(expiresIn)
      })
      .catch((error) => {
        if (!active) return
        if (error.message !== "Authentication required") {
          setSessionError(error.message)
        }
      })
      .finally(() => {
        if (active) setCheckingSession(false)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (!token || accessTokenTtlSeconds < 60) return undefined

    let active = true
    let timeoutId
    const renewSession = async () => {
      try {
        const session = await refreshAccessToken()
        if (!active) return
        setUser(session.user)
        setAccessTokenTtlSeconds(session.expiresIn)
        timeoutId = window.setTimeout(
          renewSession,
          Math.max(15_000, Math.floor(session.expiresIn * 750)),
        )
      } catch (error) {
        if (!active) return
        if (error.message === "Authentication required") {
          setUser(null)
        } else {
          setSessionError(error.message)
        }
        timeoutId = window.setTimeout(renewSession, 15_000)
      }
    }

    timeoutId = window.setTimeout(
      renewSession,
      Math.max(15_000, Math.floor(accessTokenTtlSeconds * 750)),
    )
    return () => {
      active = false
      window.clearTimeout(timeoutId)
    }
  }, [accessTokenTtlSeconds, token])

  useEffect(() => {
    const controller = new AbortController()
    const checkBackendHealth = async () => {
      try {
        await fetchBackendHealth(fetch, controller.signal)
        setBackendStatus("ready")
      } catch (error) {
        if (controller.signal.aborted) return
        console.error("Backend health check failed", error)
        setBackendStatus("unavailable")
      }
    }

    checkBackendHealth()
    const intervalId = window.setInterval(checkBackendHealth, 15000)
    return () => {
      window.clearInterval(intervalId)
      controller.abort()
    }
  }, [])

  const handleAuthenticated = ({ token: nextToken, user: authenticatedUser, expiresIn }) => {
    setAccessToken(nextToken)
    setSessionError("")
    setUser(authenticatedUser)
    setAccessTokenTtlSeconds(expiresIn)
    setCheckingSession(false)
  }

  const handleSignOut = async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" })
    } catch (error) {
      setSessionError(error.message)
    } finally {
      setAccessToken(null)
      setUser(null)
      setAccessTokenTtlSeconds(0)
    }
  }

  if (checkingSession) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-950 text-white" role="status">
        Checking your session...
      </main>
    )
  }

  if (!token || !user) {
    return (
      <>
        <AuthPanel onAuthenticated={handleAuthenticated} />
        {(sessionError || backendStatus !== "ready") && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded bg-gray-800 px-4 py-2 text-sm text-white">
            {sessionError || `Backend: ${backendStatus}`}
          </div>
        )}
      </>
    )
  }

  return (
    <Workspace
      token={token}
      user={user}
      backendStatus={backendStatus}
      onSignOut={handleSignOut}
    />
  )
}

export default App
