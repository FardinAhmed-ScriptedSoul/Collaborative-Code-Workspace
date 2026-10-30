function ParticipantSidebar({ username, usernameInput, users, onJoin, onUsernameInputChange }) {
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
        <button type="submit" className="rounded bg-gray-800 px-3 py-2 text-white">
          {username ? "Update username" : "Join"}
        </button>
      </form>

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
