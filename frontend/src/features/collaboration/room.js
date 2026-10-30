export const DEFAULT_ROOM_NAME = "monaco-room"

const ROOM_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/

export function isValidRoomName(roomName) {
  return typeof roomName === "string" && ROOM_NAME_PATTERN.test(roomName)
}

export function getRoomNameFromSearch(search) {
  return new URLSearchParams(search).get("room") ?? DEFAULT_ROOM_NAME
}

export function createRoomShareUrl(currentUrl, roomName) {
  if (!isValidRoomName(roomName)) {
    throw new Error("Room name is invalid")
  }

  const shareUrl = new URL(currentUrl)
  shareUrl.searchParams.set("room", roomName)
  shareUrl.searchParams.delete("username")
  return shareUrl.toString()
}
