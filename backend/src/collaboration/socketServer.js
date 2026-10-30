import { Server } from "socket.io"
import { YSocketIO } from "y-socket.io/dist/server"

function attachCollaborationServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  })

  const ySocketIO = new YSocketIO(io, {})
  ySocketIO.initialize()

  return io
}

export default attachCollaborationServer
