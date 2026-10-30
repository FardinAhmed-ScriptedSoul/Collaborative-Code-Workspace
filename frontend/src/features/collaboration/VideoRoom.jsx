import { useCallback, useEffect, useRef, useState } from "react"

function RemoteVideo({ stream, label }) {
  const videoRef = useRef(null)

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream
  }, [stream])

  return (
    <figure className="min-w-0">
      <video ref={videoRef} autoPlay playsInline className="aspect-video w-full rounded bg-black" />
      <figcaption className="mt-1 text-xs text-gray-300">{label}</figcaption>
    </figure>
  )
}

function VideoRoom({ socket, projectId, peers }) {
  const localVideoRef = useRef(null)
  const localStreamRef = useRef(null)
  const peerConnections = useRef(new Map())
  const candidateQueues = useRef(new Map())
  const [remoteStreams, setRemoteStreams] = useState({})
  const [microphones, setMicrophones] = useState([])
  const [cameras, setCameras] = useState([])
  const [microphoneId, setMicrophoneId] = useState("")
  const [cameraId, setCameraId] = useState("")
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [error, setError] = useState("")
  const [active, setActive] = useState(false)

  const createPeerConnection = useCallback((remoteSocketId) => {
    const connection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    })
    peerConnections.current.set(remoteSocketId, connection)

    for (const track of localStreamRef.current?.getTracks() ?? []) {
      connection.addTrack(track, localStreamRef.current)
    }
    connection.onicecandidate = ({ candidate }) => {
      if (!candidate) return
      socket.emit("webrtc:signal", {
        projectId,
        targetSocketId: remoteSocketId,
        candidate,
      })
    }
    connection.ontrack = ({ streams }) => {
      if (streams[0]) {
        setRemoteStreams((current) => ({ ...current, [remoteSocketId]: streams[0] }))
      }
    }
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed" || connection.connectionState === "disconnected") {
        connection.close()
        peerConnections.current.delete(remoteSocketId)
        setRemoteStreams((current) => {
          const next = { ...current }
          delete next[remoteSocketId]
          return next
        })
      }
    }
    return connection
  }, [projectId, socket])

  useEffect(() => {
    let isMounted = true
    navigator.mediaDevices?.enumerateDevices().then((devices) => {
      if (!isMounted) return
      setMicrophones(devices.filter((device) => device.kind === "audioinput"))
      setCameras(devices.filter((device) => device.kind === "videoinput"))
    }).catch((deviceError) => {
      console.error("Could not enumerate media devices", deviceError)
    })
    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => {
    if (!socket) return undefined

    const handlePeerLeft = ({ socketId }) => {
      peerConnections.current.get(socketId)?.close()
      peerConnections.current.delete(socketId)
      candidateQueues.current.delete(socketId)
      setRemoteStreams((current) => {
        const next = { ...current }
        delete next[socketId]
        return next
      })
    }

    socket.on("webrtc:signal", async (signal) => {
      const { fromSocketId, description, candidate } = signal
      let connection = peerConnections.current.get(fromSocketId)
      if (!connection) connection = createPeerConnection(fromSocketId)

      try {
        if (description) {
          await connection.setRemoteDescription(description)
          const queuedCandidates = candidateQueues.current.get(fromSocketId) ?? []
          candidateQueues.current.delete(fromSocketId)
          for (const queuedCandidate of queuedCandidates) {
            await connection.addIceCandidate(queuedCandidate)
          }
          if (description.type === "offer") {
            const answer = await connection.createAnswer()
            await connection.setLocalDescription(answer)
            socket.emit("webrtc:signal", {
              projectId,
              targetSocketId: fromSocketId,
              description: connection.localDescription,
            })
          }
        } else if (candidate) {
          if (connection.remoteDescription) {
            await connection.addIceCandidate(candidate)
          } else {
            const queue = candidateQueues.current.get(fromSocketId) ?? []
            queue.push(candidate)
            candidateQueues.current.set(fromSocketId, queue)
          }
        }
      } catch (signalError) {
        console.error("Could not process WebRTC signaling message", signalError)
        setError("A teammate's call could not be connected.")
      }
    })
    socket.on("webrtc:peer-left", handlePeerLeft)

    return () => {
      socket.off("webrtc:signal")
      socket.off("webrtc:peer-left", handlePeerLeft)
    }
  }, [createPeerConnection, projectId, socket])

  async function connectToPeer(peer) {
    if (!socket.id || socket.id.localeCompare(peer.socketId) >= 0
      || peerConnections.current.has(peer.socketId)) {
      return
    }
    const connection = createPeerConnection(peer.socketId)
    try {
      const offer = await connection.createOffer()
      await connection.setLocalDescription(offer)
      socket.emit("webrtc:signal", {
        projectId,
        targetSocketId: peer.socketId,
        description: connection.localDescription,
      })
    } catch (signalError) {
      console.error("Could not start a peer connection", signalError)
      setError("Could not start a call with a teammate.")
    }
  }

  async function startCall() {
    setError("")
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support microphone or camera access.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: microphoneId ? { deviceId: { exact: microphoneId } } : true,
        video: videoEnabled
          ? (cameraId ? { deviceId: { exact: cameraId } } : true)
          : false,
      })
      localStreamRef.current = stream
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
      setActive(true)
      await Promise.all(peers.map(connectToPeer))
    } catch (mediaError) {
      console.error("Could not access selected media devices", mediaError)
      setError("Microphone or camera access was denied or unavailable.")
    }
  }

  function leaveCall() {
    for (const connection of peerConnections.current.values()) connection.close()
    peerConnections.current.clear()
    candidateQueues.current.clear()
    for (const track of localStreamRef.current?.getTracks() ?? []) track.stop()
    localStreamRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    setRemoteStreams({})
    setActive(false)
  }

  useEffect(() => () => {
    for (const connection of peerConnections.current.values()) connection.close()
    for (const track of localStreamRef.current?.getTracks() ?? []) track.stop()
  }, [])

  return (
    <section className="rounded border border-gray-700 p-3" aria-label="Project voice and video">
      <h2 className="font-semibold text-white">Voice and video</h2>
      {!active ? (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs text-gray-300">
            Microphone
            <select
              value={microphoneId}
              onChange={(event) => setMicrophoneId(event.target.value)}
              className="max-w-40 rounded bg-gray-800 px-2 py-1"
            >
              <option value="">Default microphone</option>
              {microphones.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-300">
            Camera
            <select
              value={cameraId}
              onChange={(event) => setCameraId(event.target.value)}
              disabled={!videoEnabled}
              className="max-w-40 rounded bg-gray-800 px-2 py-1"
            >
              <option value="">Default camera</option>
              {cameras.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Camera ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={videoEnabled}
              onChange={(event) => setVideoEnabled(event.target.checked)}
            />
            Enable camera
          </label>
          <button type="button" onClick={startCall} className="rounded bg-emerald-700 px-3 py-1 text-white">
            Join call
          </button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-start gap-3">
          <figure className="w-40">
            <video ref={localVideoRef} autoPlay muted playsInline className="aspect-video w-full rounded bg-black" />
            <figcaption className="mt-1 text-xs text-gray-300">You</figcaption>
          </figure>
          {Object.entries(remoteStreams).map(([socketId, stream]) => (
            <RemoteVideo key={socketId} stream={stream} label="Teammate" />
          ))}
          <button type="button" onClick={leaveCall} className="rounded bg-red-700 px-3 py-1 text-white">
            Leave call
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-300" role="alert">{error}</p>}
      <p className="mt-1 text-xs text-gray-400">
        Media is peer-to-peer. Your browser will request device permission when you join.
      </p>
    </section>
  )
}

export default VideoRoom
