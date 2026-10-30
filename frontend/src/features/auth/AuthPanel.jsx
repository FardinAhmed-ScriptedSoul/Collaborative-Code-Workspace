import { useState } from "react"
import { apiRequest } from "../../shared/api.js"

function AuthPanel({ onAuthenticated }) {
  const [mode, setMode] = useState("login")
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError("")
    setSubmitting(true)

    try {
      const result = await apiRequest(`/api/auth/${mode === "register" ? "register" : "login"}`, {
        method: "POST",
        body: JSON.stringify({ email, name, password }),
      })
      onAuthenticated(result)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 p-6">
      <section className="w-full max-w-md rounded-xl bg-white p-8 shadow-xl">
        <h1 className="text-2xl font-bold text-gray-900">Collaborative Workspace</h1>
        <p className="mt-2 text-sm text-gray-600">Sign in to work on a project with your team.</p>
        <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit}>
          {mode === "register" && (
            <label className="flex flex-col gap-1 font-medium">
              Name
              <input
                autoComplete="name"
                required
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded border border-gray-300 px-3 py-2"
              />
            </label>
          )}
          <label className="flex flex-col gap-1 font-medium">
            Email
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Password
            <input
              type="password"
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              required
              minLength={mode === "register" ? 12 : 1}
              maxLength={256}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded border border-gray-300 px-3 py-2"
            />
          </label>
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded bg-gray-900 px-4 py-3 font-semibold text-white disabled:opacity-60"
          >
            {submitting ? "Please wait..." : mode === "register" ? "Create account" : "Sign in"}
          </button>
        </form>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "register" ? "login" : "register")
            setError("")
          }}
          className="mt-5 text-sm font-medium text-amber-800 underline"
        >
          {mode === "register" ? "Already have an account? Sign in" : "New here? Create an account"}
        </button>
      </section>
    </main>
  )
}

export default AuthPanel
