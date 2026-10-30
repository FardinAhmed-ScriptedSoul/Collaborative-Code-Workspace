import assert from "node:assert/strict"
import test from "node:test"
import {
  createRoomShareUrl,
  DEFAULT_ROOM_NAME,
  getRoomNameFromSearch,
  isValidRoomName,
} from "../../src/features/collaboration/room.js"

test("keeps the existing default room when a room is not specified", () => {
  assert.equal(getRoomNameFromSearch("?username=Alex"), DEFAULT_ROOM_NAME)
})

test("reads a room name from the shared URL", () => {
  assert.equal(getRoomNameFromSearch("?room=team-room_2"), "team-room_2")
})

test("accepts valid room names and rejects unsupported characters", () => {
  assert.equal(isValidRoomName("team-room_2"), true)
  assert.equal(isValidRoomName("2"), true)
  assert.equal(isValidRoomName("-team"), false)
  assert.equal(isValidRoomName("team room"), false)
  assert.equal(isValidRoomName("a".repeat(65)), false)
})

test("creates a room link without reusing the current user's display name", () => {
  const shareUrl = new URL(createRoomShareUrl(
    "https://workspace.example/editor?username=Alex&theme=dark",
    "team-room",
  ))

  assert.equal(shareUrl.searchParams.get("room"), "team-room")
  assert.equal(shareUrl.searchParams.has("username"), false)
  assert.equal(shareUrl.searchParams.get("theme"), "dark")
})

test("does not create share links for invalid room names", () => {
  assert.throws(
    () => createRoomShareUrl("https://workspace.example/editor", "bad room"),
    /Room name is invalid/,
  )
})
