import { createServer } from "http"
import app from "./app.js"
import attachCollaborationServer from "./collaboration/socketServer.js"

const httpServer = createServer(app)
attachCollaborationServer(httpServer)

const port = process.env.PORT || 3000

httpServer.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
