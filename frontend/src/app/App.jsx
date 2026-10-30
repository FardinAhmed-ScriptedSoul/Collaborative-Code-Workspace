import "./App.css"
import { MonacoBinding } from "y-monaco"
import { useEffect, useMemo, useState } from "react"
import * as Y from "yjs"
import { SocketIOProvider } from "y-socket.io"
import CollaborativeEditor from "../features/collaboration/CollaborativeEditor.jsx"
import ParticipantSidebar from "../features/collaboration/ParticipantSidebar.jsx"

function App() {
  const [editor, setEditor] = useState(null)
  const [username, setUsername] = useState(() => new URLSearchParams(window.location.search).get("username")?.trim() ?? "")
  const [usernameInput, setUsernameInput] = useState(username)
  const [users, setUsers] = useState([])
  const ydoc = useMemo(() => new Y.Doc(), [])
  const ytext = useMemo(() => ydoc.getText("monaco"), [ydoc])

  const handleJoin = (e) => {
    e.preventDefault()
    const nextUsername = usernameInput.trim()
    if (!nextUsername) return

    setUsername(nextUsername)
    const url = new URL(window.location.href)
    url.searchParams.set("username", nextUsername)
    window.history.replaceState({}, "", url)
  }

  const handleUsernameInputChange = (nextUsername) => {
    setUsernameInput(nextUsername)
  }

  useEffect(() => {
    if (!username || !editor) return

    const model = editor.getModel()
    if (!model) return

    const collaborationProvider = new SocketIOProvider(
      "http://localhost:3000",
      "monaco-room",
      ydoc,
      {},
    )
    const updateUsers = () => {
      const connectedUsers = Array.from(collaborationProvider.awareness.getStates().entries())
        .filter(([, state]) => state.user?.username)
        .map(([clientId, state]) => ({ clientId, username: state.user.username }))
      setUsers(connectedUsers)
    }

    collaborationProvider.awareness.on("change", updateUsers)
    collaborationProvider.awareness.setLocalStateField("user", { username })
    const binding = new MonacoBinding(ytext, model, new Set([editor]), collaborationProvider.awareness)

    return () => {
      binding.destroy()
      collaborationProvider.awareness.off("change", updateUsers)
      collaborationProvider.destroy()
    }
  }, [editor, username, ydoc, ytext])

  return (
    <main className="flex h-screen w-full gap-4 bg-gray-950 p-4">
      <ParticipantSidebar
        username={username}
        usernameInput={usernameInput}
        users={users}
        onJoin={handleJoin}
        onUsernameInputChange={handleUsernameInputChange}
      />
      <CollaborativeEditor onMount={setEditor} />
    </main>
  )
}

export default App
