export async function fetchBackendHealth(fetchImplementation, signal) {
  const response = await fetchImplementation("/health/ready", { signal })
  if (!response.ok) {
    throw new Error(`Backend health check returned HTTP ${response.status}`)
  }

  const health = await response.json()
  if (health.status !== "ready") {
    throw new Error("Backend is not ready")
  }

  return health
}
