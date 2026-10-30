function parsePort(value) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535")
  }
  return port
}

function loadConfig(environment = process.env) {
  const mongodbUri = environment.MONGODB_URI || "mongodb://localhost:27017/"
  const databaseName = environment.DB_NAME || "Orbit"

  if (!mongodbUri.startsWith("mongodb://") && !mongodbUri.startsWith("mongodb+srv://")) {
    throw new Error("MONGODB_URI must use the mongodb:// or mongodb+srv:// scheme")
  }

  if (!databaseName.trim()) {
    throw new Error("DB_NAME must not be empty")
  }

  return Object.freeze({
    mongodbUri,
    databaseName: databaseName.trim(),
    port: parsePort(environment.PORT || "3000"),
  })
}

export default loadConfig
