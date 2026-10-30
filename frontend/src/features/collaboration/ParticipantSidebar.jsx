function ParticipantSidebar({
  username,
  usernameInput,
  roomInput,
  users,
  backendStatus,
  formError,
  shareMessage,
  onJoin,
  onUsernameInputChange,
  onRoomInputChange,
  onShareRoom,
}) {
  return (
    <aside className="h-full w-1/4 rounded-lg bg-amber-50">
      <form className="flex flex-col gap-2 border-b border-gray-300 p-4" onSubmit={onJoin}>
        <label htmlFor="username" className="font-bold">Username</label>
        <input
          id="username"
          name="username"
          type="text"
          value={usernameInput}
          onChange={(event) => onUsernameInputChange(event.target.value)}
          placeholder="Enter your username"
          maxLength={32}
          required
          className="rounded border border-gray-300 px-3 py-2"
        />
        <label htmlFor="room" className="font-bold">Room</label>
        <input
          id="room"
          name="room"
          type="text"
          value={roomInput}
          onChange={(event) => onRoomInputChange(event.target.value)}
          placeholder="Enter a room name"
          maxLength={64}
          pattern="[A-Za-z0-9][A-Za-z0-9_-]{0,63}"
          title="Start with a letter or number; use letters, numbers, hyphens, or underscores."
          required
          className="rounded border border-gray-300 px-3 py-2"
        />
        {formError && <p className="text-sm text-red-700" role="alert">{formError}</p>}
        <button type="submit" className="rounded bg-gray-800 px-3 py-2 text-white">
          {username ? "Join room" : "Join"}
        </button>
      </form>

      <section className="border-b border-gray-300 p-4">
        <button
          type="button"
          onClick={onShareRoom}
          className="w-full rounded bg-amber-700 px-3 py-2 text-white"
        >
          Copy room link
        </button>
        {shareMessage && <p className="mt-2 text-sm text-gray-700" role="status">{shareMessage}</p>}
      </section>

      <p className="border-b border-gray-300 p-4 text-sm" role="status">
        Backend: {backendStatus === "ready" ? "Ready" : backendStatus === "checking" ? "Checking..." : "Unavailable"}
      </p>

      <h2 className="border-b border-gray-300 p-4 text-xl font-bold">Users</h2>
      <ul className="p-4">
        {users.length > 0
          ? users.map((user) => (
              <li key={user.clientId} className="mb-2 rounded bg-gray-800 p-2 text-white">
                {user.username}
              </li>
            ))
          : <li className="text-gray-600">No users yet</li>}
      </ul>
    </aside>
  )
}

export default ParticipantSidebar
