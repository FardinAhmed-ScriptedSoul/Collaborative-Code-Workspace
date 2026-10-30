import { useCallback, useEffect, useRef, useState } from "react"
import { MonacoBinding } from "y-monaco"
import { io } from "socket.io-client"
import * as Y from "yjs"
import { SocketIOProvider } from "y-socket.io"
import { apiRequest } from "../../shared/api.js"
import CollaborativeEditor from "../collaboration/CollaborativeEditor.jsx"
import VideoRoom from "../collaboration/VideoRoom.jsx"

function Workspace({ user, token, backendStatus, onSignOut }) {
  const [organizations, setOrganizations] = useState([])
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [project, setProject] = useState(null)
  const [editor, setEditor] = useState(null)
  const [socket, setSocket] = useState(null)
  const [peers, setPeers] = useState([])
  const [messages, setMessages] = useState([])
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState("")
  const [editingMessageBody, setEditingMessageBody] = useState("")
  const [discussions, setDiscussions] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [users, setUsers] = useState([])
  const [messageInput, setMessageInput] = useState("")
  const [organizationInput, setOrganizationInput] = useState("")
  const [projectInput, setProjectInput] = useState("")
  const [memberEmail, setMemberEmail] = useState("")
  const [memberRole, setMemberRole] = useState("editor")
  const [inviteLink, setInviteLink] = useState("")
  const [snapshotName, setSnapshotName] = useState("")
  const [discussionInput, setDiscussionInput] = useState("")
  const [selection, setSelection] = useState(null)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const chatEndRef = useRef(null)
  const processedInvitationRef = useRef("")

  const fetchWorkspace = useCallback(() => Promise.all([
    apiRequest("/api/organizations", { token }),
    apiRequest("/api/projects", { token }),
  ]), [token])

  const refreshWorkspace = useCallback(async () => {
    const [organizationResult, projectResult] = await fetchWorkspace()
    setOrganizations(organizationResult.organizations)
    setProjects(projectResult.projects)
  }, [fetchWorkspace])

  const handleSelectProject = useCallback((projectId) => {
    if (projectId === selectedProjectId) return
    setSelectedProjectId(projectId)
    setProject(null)
    setMessages([])
    setHasMoreMessages(false)
    setDiscussions([])
    setSnapshots([])
    setUsers([])
    setPeers([])
    setSocket(null)
    setSelection(null)
  }, [selectedProjectId])

  useEffect(() => {
    let active = true
    fetchWorkspace()
      .then(([organizationResult, projectResult]) => {
        if (!active) return
        setOrganizations(organizationResult.organizations)
        setProjects(projectResult.projects)
      })
      .catch((loadError) => {
        if (active) setError(loadError.message)
      })
    return () => {
      active = false
    }
  }, [fetchWorkspace])

  useEffect(() => {
    const invitationToken = new URLSearchParams(window.location.search).get("invite")
    if (!invitationToken || processedInvitationRef.current === invitationToken) return
    processedInvitationRef.current = invitationToken
    apiRequest("/api/invitations/accept", {
      token,
      method: "POST",
      body: JSON.stringify({ token: invitationToken }),
    }).then(async ({ invitation }) => {
      const url = new URL(window.location.href)
      url.searchParams.delete("invite")
      window.history.replaceState(null, "", url)
      if (invitation.targetType === "project") handleSelectProject(invitation.targetId)
      setNotice(`Invitation accepted as ${invitation.role}.`)
      await refreshWorkspace()
    }).catch((requestError) => setError(requestError.message))
  }, [handleSelectProject, refreshWorkspace, token])

  const handleLoadOlderMessages = useCallback(async () => {
    if (!project || !messages.length || loadingOlderMessages) return
    setLoadingOlderMessages(true)
    try {
      const before = encodeURIComponent(messages[0].createdAt)
      const result = await apiRequest(
        `/api/projects/${project.id}/messages?limit=50&before=${before}`,
        { token },
      )
      setMessages((current) => {
        const byId = new Map(current.map((message) => [message.id, message]))
        for (const message of result.messages) byId.set(message.id, message)
        return Array.from(byId.values()).sort(
          (left, right) => new Date(left.createdAt) - new Date(right.createdAt),
        )
      })
      setHasMoreMessages(result.hasMore)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoadingOlderMessages(false)
    }
  }, [loadingOlderMessages, messages, project, token])

  useEffect(() => {
    if (!selectedProjectId) return undefined

    const controller = new AbortController()
    let active = true
    const loadProject = async () => {
      try {
        const [projectResult, messageResult, discussionResult, snapshotResult] = await Promise.all([
          apiRequest(`/api/projects/${selectedProjectId}`, { token, signal: controller.signal }),
          apiRequest(`/api/projects/${selectedProjectId}/messages`, { token, signal: controller.signal }),
          apiRequest(`/api/projects/${selectedProjectId}/discussions`, { token, signal: controller.signal }),
          apiRequest(`/api/projects/${selectedProjectId}/snapshots`, { token, signal: controller.signal }),
        ])
        if (!active) return
        setProject(projectResult.project)
        setMessages(messageResult.messages)
        setHasMoreMessages(messageResult.hasMore)
        setDiscussions(discussionResult.discussions)
        setSnapshots(snapshotResult.snapshots)
      } catch (loadError) {
        if (!controller.signal.aborted) setError(loadError.message)
      }
    }

    const projectSocket = io(window.location.origin, {
      auth: { token },
      transports: ["websocket", "polling"],
    })
    const joinProject = () => {
      if (!active) return
      setSocket(projectSocket)
      projectSocket.emit("project:join", { projectId: selectedProjectId }, (result) => {
        if (result?.error) {
          setError(result.error)
          return
        }
        setPeers(result.peers ?? [])
      })
    }
    const addMessage = (message) => {
      setMessages((current) => current.some((item) => item.id === message.id)
        ? current
        : [...current, message])
    }
    const updateMessage = (message) => {
      setMessages((current) => current.map((item) => (
        item.id === message.id ? { ...item, ...message } : item
      )))
    }
    const deleteMessage = ({ messageId }) => {
      setMessages((current) => current.filter((item) => item.id !== messageId))
    }
    const addDiscussion = (discussion) => {
      setDiscussions((current) => current.some((item) => item.id === discussion.id)
        ? current
        : [discussion, ...current])
    }
    const updateDiscussion = (discussion) => {
      setDiscussions((current) => current.map((item) => (
        item.id === discussion.id ? { ...item, ...discussion } : item
      )))
    }
    const addPeer = (peer) => {
      setPeers((current) => current.some((item) => item.socketId === peer.socketId)
        ? current
        : [...current, peer])
    }

    loadProject()
    projectSocket.on("connect", joinProject)
    projectSocket.on("chat:new", addMessage)
    projectSocket.on("chat:updated", updateMessage)
    projectSocket.on("chat:deleted", deleteMessage)
    projectSocket.on("discussion:new", addDiscussion)
    projectSocket.on("discussion:updated", updateDiscussion)
    projectSocket.on("webrtc:peer-joined", addPeer)
    projectSocket.on("webrtc:peer-left", ({ socketId }) => {
      setPeers((current) => current.filter((peer) => peer.socketId !== socketId))
    })
    projectSocket.on("connect_error", (socketError) => {
      setError(`Realtime connection failed: ${socketError.message}`)
    })
    return () => {
      active = false
      controller.abort()
      projectSocket.disconnect()
      projectSocket.off("connect", joinProject)
      projectSocket.off("chat:new", addMessage)
      projectSocket.off("chat:updated", updateMessage)
      projectSocket.off("chat:deleted", deleteMessage)
    }
  }, [selectedProjectId, token])

  useEffect(() => {
    if (!editor || !project || !selectedProjectId) return undefined
    const model = editor.getModel()
    if (!model) return undefined

    const document = new Y.Doc()
    const text = document.getText("monaco")
    const provider = new SocketIOProvider(
      window.location.origin,
      selectedProjectId,
      document,
      {
        auth: { token, projectId: selectedProjectId },
      },
    )
    const updateParticipants = () => {
      setUsers(Array.from(provider.awareness.getStates().entries())
        .filter(([, state]) => state.user?.name)
        .map(([clientId, state]) => ({ clientId, name: state.user.name })))
    }
    provider.awareness.on("change", updateParticipants)
    provider.awareness.setLocalStateField("user", { name: user.name })
    const binding = new MonacoBinding(text, model, new Set([editor]), provider.awareness)

    return () => {
      binding.destroy()
      provider.awareness.off("change", updateParticipants)
      provider.destroy()
      document.destroy()
    }
  }, [editor, project, selectedProjectId, token, user.name])

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" })
  }, [messages])

  const handleCreateOrganization = async (event) => {
    event.preventDefault()
    setError("")
    try {
      await apiRequest("/api/organizations", {
        token,
        method: "POST",
        body: JSON.stringify({ name: organizationInput }),
      })
      setOrganizationInput("")
      await refreshWorkspace()
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const handleCreateProject = async (event) => {
    event.preventDefault()
    const organization = organizations[0]
    if (!organization) {
      setError("Create an organization before adding a project.")
      return
    }
    setError("")
    try {
      const result = await apiRequest("/api/projects", {
        token,
        method: "POST",
        body: JSON.stringify({ name: projectInput, organizationId: organization.id }),
      })
      setProjectInput("")
      await refreshWorkspace()
      handleSelectProject(result.project.id)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const handleAddMember = async (event) => {
    event.preventDefault()
    if (!project) return
    setError("")
    try {
      const result = await apiRequest(`/api/invitations/projects/${project.id}`, {
        token,
        method: "POST",
        body: JSON.stringify({ email: memberEmail, role: memberRole }),
      })
      const url = new URL(window.location.href)
      url.searchParams.set("invite", result.invitation.token)
      setInviteLink(url.toString())
      setMemberEmail("")
      setNotice("Invitation link created. Share it with the invited teammate within 7 days.")
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const handleSendMessage = (event) => {
    event.preventDefault()
    const body = messageInput.trim()
    if (!body || !project || !socket) return
    setError("")
    socket.emit("chat:send", { projectId: project.id, body }, (result) => {
      if (result?.error) setError(result.error)
      else setMessageInput("")
    })
  }

  const handleEditMessage = async (event, messageId) => {
    event.preventDefault()
    try {
      const result = await apiRequest(
        `/api/projects/${project.id}/messages/${messageId}`,
        {
          token,
          method: "PATCH",
          body: JSON.stringify({ body: editingMessageBody }),
        },
      )
      setMessages((current) => current.map((message) => (
        message.id === result.message.id ? result.message : message
      )))
      setEditingMessageId("")
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const handleDeleteMessage = async (messageId) => {
    try {
      await apiRequest(`/api/projects/${project.id}/messages/${messageId}`, {
        token,
        method: "DELETE",
      })
      setMessages((current) => current.filter((message) => message.id !== messageId))
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const handleSaveDiscussion = async (event) => {
    event.preventDefault()
    if (!project || !selection) return
    setError("")
    try {
      const result = await apiRequest(`/api/projects/${project.id}/discussions`, {
        token,
        method: "POST",
        body: JSON.stringify({
          ...selection,
          body: discussionInput,
        }),
      })
      setDiscussions((current) => [result.discussion, ...current])
      setDiscussionInput("")
      setSelection(null)
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const handleResolveDiscussion = async (discussion, status) => {
    try {
      const result = await apiRequest(`/api/projects/${project.id}/discussions/${discussion.id}`, {
        token,
        method: "PATCH",
        body: JSON.stringify({ status }),
      })
      setDiscussions((current) => current.map((item) => (
        item.id === result.discussion.id ? result.discussion : item
      )))
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const handleNavigateDiscussion = (discussion) => {
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    const source = model.getValue()
    const selectedText = discussion.anchor.selectedText.trim()
    const matchIndex = selectedText ? source.indexOf(selectedText) : -1
    const startLine = matchIndex >= 0
      ? source.slice(0, matchIndex).split("\n").length
      : discussion.anchor.startLine
    const endLine = matchIndex >= 0
      ? startLine + selectedText.split("\n").length - 1
      : discussion.anchor.endLine
    editor.setSelection({
      startLineNumber: startLine,
      startColumn: 1,
      endLineNumber: endLine,
      endColumn: 1,
    })
    editor.revealLineInCenter(startLine)
    editor.focus()
  }

  const handleSaveSnapshot = async (event) => {
    event.preventDefault()
    if (!project || !editor) return
    try {
      await apiRequest(`/api/projects/${project.id}/snapshots`, {
        token,
        method: "POST",
        body: JSON.stringify({ name: snapshotName, code: editor.getValue() }),
      })
      setSnapshotName("")
      const result = await apiRequest(`/api/projects/${project.id}/snapshots`, { token })
      setSnapshots(result.snapshots)
      setNotice("Snapshot saved.")
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const handleRestoreSnapshot = async (snapshotId) => {
    if (!project || !editor) return
    try {
      const result = await apiRequest(
        `/api/projects/${project.id}/snapshots/${snapshotId}`,
        { token },
      )
      const model = editor.getModel()
      if (model) {
        editor.executeEdits("restore-snapshot", [{
          range: model.getFullModelRange(),
          text: result.snapshot.code,
        }])
      }
      setNotice("Snapshot restored into the shared editor.")
    } catch (requestError) {
      setError(requestError.message)
    }
  }

  const handleEditorMount = (mountedEditor) => {
    setEditor(mountedEditor)
    mountedEditor.onDidChangeCursorSelection(() => {
      const model = mountedEditor.getModel()
      const range = mountedEditor.getSelection()
      if (!model || !range || range.isEmpty()) {
        setSelection(null)
        return
      }
      setSelection({
        startLine: range.startLineNumber,
        endLine: range.endLineNumber,
        selectedText: model.getValueInRange(range).slice(0, 10_000),
      })
    })
  }

  return (
    <main className="flex min-h-screen flex-col bg-gray-950 text-gray-100 lg:h-screen">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 px-4 py-3">
        <div>
          <h1 className="text-xl font-bold">Collaborative Workspace</h1>
          <p className="text-sm text-gray-400">Signed in as {user.name} ({user.email})</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400" role="status">Backend: {backendStatus}</span>
          <button type="button" onClick={onSignOut} className="rounded border border-gray-600 px-3 py-2">
            Sign out
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[270px_minmax(0,1fr)_320px]">
        <aside className="flex flex-col gap-4 border-b border-gray-800 p-4 lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Project
            <select
              value={selectedProjectId}
              onChange={(event) => handleSelectProject(event.target.value)}
              className="rounded border border-gray-700 bg-gray-900 px-3 py-2"
            >
              <option value="">Select a project</option>
              {projects.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>

          <form onSubmit={handleCreateOrganization} className="flex flex-col gap-2">
            <label htmlFor="organization-name" className="text-sm font-semibold">New organization</label>
            <input
              id="organization-name"
              value={organizationInput}
              onChange={(event) => setOrganizationInput(event.target.value)}
              maxLength={80}
              placeholder="Organization name"
              className="rounded border border-gray-700 bg-gray-900 px-3 py-2"
            />
            <button type="submit" className="rounded bg-amber-700 px-3 py-2 text-sm">Create organization</button>
          </form>

          {organizations.length > 0 && (
            <form onSubmit={handleCreateProject} className="flex flex-col gap-2">
              <label htmlFor="project-name" className="text-sm font-semibold">New project</label>
              <input
                id="project-name"
                value={projectInput}
                onChange={(event) => setProjectInput(event.target.value)}
                maxLength={100}
                placeholder="Project name"
                className="rounded border border-gray-700 bg-gray-900 px-3 py-2"
              />
              <button type="submit" className="rounded bg-amber-700 px-3 py-2 text-sm">Create project</button>
            </form>
          )}

          {project && (
            <>
              <section>
                <h2 className="font-semibold">Project members</h2>
                <p className="mt-1 text-sm text-gray-400">Your role: {project.role}</p>
                {project.canManageMembers && (
                  <form onSubmit={handleAddMember} className="mt-2 flex flex-col gap-2">
                    <label htmlFor="member-email" className="text-xs">Invite teammate by email</label>
                    <input
                      id="member-email"
                      type="email"
                      required
                      value={memberEmail}
                      onChange={(event) => setMemberEmail(event.target.value)}
                      placeholder="teammate@example.com"
                      className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
                    />
                    <select
                      value={memberRole}
                      onChange={(event) => setMemberRole(event.target.value)}
                      className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
                    >
                      <option value="editor">Editor</option>
                      <option value="viewer">Viewer</option>
                    </select>
                    <button type="submit" className="rounded bg-gray-700 px-3 py-2 text-sm">Create invitation link</button>
                    {inviteLink && (
                      <label className="flex flex-col gap-1 text-xs text-gray-400">
                        Share this single-use link with {memberEmail || "the invited teammate"}:
                        <input
                          readOnly
                          value={inviteLink}
                          onFocus={(event) => event.target.select()}
                          className="rounded border border-gray-700 bg-gray-900 px-2 py-1 text-white"
                        />
                      </label>
                    )}
                  </form>
                )}
              </section>

              <VideoRoom socket={socket} projectId={project.id} peers={peers} />
            </>
          )}
        </aside>

        <section className="flex min-h-[60vh] flex-col p-3 lg:min-h-0">
          {project ? (
            <>
              <div className="mb-2 flex items-center justify-between gap-3">
                <h2 className="font-semibold">{project.name}</h2>
                <span className="text-xs text-gray-400" role="status">
                  {users.length} participant{users.length === 1 ? "" : "s"} online
                </span>
              </div>
              <div className="min-h-[400px] flex-1 overflow-hidden rounded border border-gray-800 lg:min-h-0">
                <CollaborativeEditor
                  onMount={handleEditorMount}
                  readOnly={project.role === "viewer"}
                />
              </div>
              {selection && project.role !== "viewer" && (
                <form onSubmit={handleSaveDiscussion} className="mt-2 flex gap-2">
                  <label className="sr-only" htmlFor="discussion-text">Discuss selected code</label>
                  <input
                    id="discussion-text"
                    required
                    maxLength={2000}
                    value={discussionInput}
                    onChange={(event) => setDiscussionInput(event.target.value)}
                    placeholder={`Discuss lines ${selection.startLine}-${selection.endLine}`}
                    className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2"
                  />
                  <button type="submit" className="rounded bg-amber-700 px-3 py-2">Start discussion</button>
                </form>
              )}
              {project.role !== "viewer" && (
                <form onSubmit={handleSaveSnapshot} className="mt-2 flex gap-2">
                  <label className="sr-only" htmlFor="snapshot-name">Snapshot name</label>
                  <input
                    id="snapshot-name"
                    required
                    maxLength={100}
                    value={snapshotName}
                    onChange={(event) => setSnapshotName(event.target.value)}
                    placeholder="Snapshot name"
                    className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2"
                  />
                  <button type="submit" className="rounded bg-gray-700 px-3 py-2">Save snapshot</button>
                </form>
              )}
            </>
          ) : (
            <div className="m-auto max-w-md text-center">
              <h2 className="text-xl font-semibold">Choose where to collaborate</h2>
              <p className="mt-2 text-gray-400">Select an existing project or create an organization and project to begin.</p>
            </div>
          )}
        </section>

        <aside className="grid min-h-0 grid-rows-2 border-t border-gray-800 lg:border-l lg:border-t-0">
          <section className="flex min-h-64 flex-col border-b border-gray-800 p-4">
            <h2 className="font-semibold">Project chat</h2>
            <div className="mt-2 flex-1 overflow-y-auto" aria-live="polite">
              {hasMoreMessages && (
                <button
                  type="button"
                  onClick={handleLoadOlderMessages}
                  disabled={loadingOlderMessages}
                  className="mb-3 text-xs text-gray-400 underline"
                >
                  {loadingOlderMessages ? "Loading..." : "Load older messages"}
                </button>
              )}
              {messages.map((message) => (
                <article key={message.id} className="mb-3 text-sm">
                  <p className="font-semibold">{message.author.name} <time className="font-normal text-gray-500">{new Date(message.createdAt).toLocaleTimeString()}</time></p>
                  {editingMessageId === message.id ? (
                    <form onSubmit={(event) => handleEditMessage(event, message.id)} className="mt-1 flex gap-1">
                      <label className="sr-only" htmlFor={`edit-message-${message.id}`}>Edit message</label>
                      <input
                        id={`edit-message-${message.id}`}
                        value={editingMessageBody}
                        onChange={(event) => setEditingMessageBody(event.target.value)}
                        maxLength={4000}
                        className="min-w-0 flex-1 rounded bg-gray-900 px-2 py-1"
                      />
                      <button type="submit" className="underline">Save</button>
                      <button type="button" onClick={() => setEditingMessageId("")} className="underline">Cancel</button>
                    </form>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-gray-300">{message.body}</p>
                  )}
                  {project?.role !== "viewer"
                    && message.author.id === user.id
                    && editingMessageId !== message.id && (
                    <div className="mt-1 flex gap-2 text-xs text-gray-400">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMessageId(message.id)
                          setEditingMessageBody(message.body)
                        }}
                        className="underline"
                      >
                        Edit
                      </button>
                      <button type="button" onClick={() => handleDeleteMessage(message.id)} className="underline">
                        Delete
                      </button>
                    </div>
                  )}
                </article>
              ))}
              <div ref={chatEndRef} />
            </div>
            <form onSubmit={handleSendMessage} className="mt-3 flex gap-2">
              <label className="sr-only" htmlFor="chat-message">Send a message</label>
              <input
                id="chat-message"
                value={messageInput}
                onChange={(event) => setMessageInput(event.target.value)}
                maxLength={4000}
                disabled={!project || project.role === "viewer"}
                placeholder="Write a message"
                className="min-w-0 flex-1 rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
              />
              <button type="submit" disabled={!project || project.role === "viewer"} className="rounded bg-amber-700 px-3 py-2 text-sm disabled:opacity-50">
                Send
              </button>
            </form>
          </section>

          <section className="min-h-64 overflow-y-auto p-4">
            <h2 className="font-semibold">Code discussions</h2>
            <ul className="mt-2 space-y-3">
              {discussions.map((discussion) => (
                <li key={discussion.id ?? discussion._id} className="rounded border border-gray-800 p-3 text-sm">
                  <p className="font-semibold">{discussion.author.name} · lines {discussion.anchor.startLine}-{discussion.anchor.endLine}</p>
                  <pre className="my-2 overflow-x-auto rounded bg-gray-900 p-2 text-xs text-gray-300">{discussion.anchor.selectedText}</pre>
                  <p className="whitespace-pre-wrap">{discussion.body}</p>
                  <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
                    <span>{discussion.status}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleNavigateDiscussion(discussion)}
                        className="underline"
                      >
                        Go to code
                      </button>
                      {project && project.role !== "viewer" && (
                        <button
                          type="button"
                          onClick={() => handleResolveDiscussion(
                            discussion,
                            discussion.status === "open" ? "resolved" : "open",
                          )}
                          className="underline"
                        >
                          {discussion.status === "open" ? "Resolve" : "Reopen"}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <h2 className="mt-5 font-semibold">Snapshots</h2>
            <ul className="mt-2 space-y-2">
              {snapshots.map((snapshot) => (
                <li key={snapshot._id ?? snapshot.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{snapshot.name}</span>
                  {project?.role !== "viewer" && (
                    <button
                      type="button"
                      onClick={() => handleRestoreSnapshot(snapshot._id ?? snapshot.id)}
                      className="text-xs underline"
                    >
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
      {(error || notice) && (
        <div className="fixed bottom-4 left-1/2 z-10 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded bg-gray-800 px-4 py-3 shadow-lg">
          <p role={error ? "alert" : "status"} className={error ? "text-sm text-red-300" : "text-sm text-emerald-300"}>
            {error || notice}
          </p>
          <button type="button" onClick={() => { setError(""); setNotice("") }} aria-label="Dismiss message">
            ×
          </button>
        </div>
      )}
    </main>
  )
}

export default Workspace
