import { useEffect, useRef, useState, memo } from 'react'

// 🔥 Prevent duplicate connections globally
const activeStreams = new Set()

function WebRTCPlayer({ serverUrl }) {
  const videoRef = useRef(null)
  const pcRef    = useRef(null)
  const wsRef    = useRef(null)

  const [connected, setConnected] = useState(false)
<<<<<<< HEAD
  const [error, setError]         = useState('')
=======
  const [error,     setError]     = useState('')
  const [retrying,  setRetrying]  = useState(false)
  const reconnectTimeoutRef = useRef(null)
  let reconnectAttempts = useRef(0)
  const MAX_RECONNECT_ATTEMPTS = 10
  const INITIAL_RECONNECT_DELAY = 2000 // 2 seconds
  const MAX_RECONNECT_DELAY = 30000 // 30 seconds
>>>>>>> 78912786884fc3d26ad130e4c125a00250d76595

  useEffect(() => {
    let closed     = false
    let answerSent = false

    const getReconnectDelay = () => {
      const exponentialDelay = INITIAL_RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current)
      return Math.min(exponentialDelay, MAX_RECONNECT_DELAY)
    }

    async function start() {
<<<<<<< HEAD
      if (!serverUrl) return

      // 🚨 PREVENT DUPLICATE STREAM CONNECTIONS
      if (activeStreams.has(serverUrl)) {
        console.log("⚠️ Stream already active:", serverUrl)
        return
      }

      activeStreams.add(serverUrl)

      setError('')
      setConnected(false)

      // ── 1. Create Peer Connection ───────────────────────────────
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      })
      pcRef.current = pc

      pc.addTransceiver('video', { direction: 'recvonly' })
      pc.addTransceiver('audio', { direction: 'recvonly' })

      // ── 2. Handle incoming stream ───────────────────────────────
      pc.ontrack = (e) => {
        if (closed || !videoRef.current || !e.streams[0]) return
        videoRef.current.srcObject = e.streams[0]
        videoRef.current.play().catch(() => {})
        setConnected(true)
      }

      // ── 3. ICE candidates ───────────────────────────────────────
      pc.onicecandidate = (e) => {
        if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            command: 'candidate',
            candidate: e.candidate.candidate,
            sdpMid: e.candidate.sdpMid,
            sdpMLineIndex: e.candidate.sdpMLineIndex,
          }))
        }
      }

      pc.onconnectionstatechange = () => {
        if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
          if (!closed) setConnected(false)
        }
      }

      // ── 4. WebSocket signalling ─────────────────────────────────
=======
      if (!serverUrl || closed) return
      setError('')
      setConnected(false)

>>>>>>> 78912786884fc3d26ad130e4c125a00250d76595
      try {
        // ── 1. Create RTCPeerConnection with multiple STUN/TURN servers ──────
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
          ],
          iceCandidatePoolSize: 10,
        })
        pcRef.current = pc
        pc.addTransceiver('video', { direction: 'recvonly' })
        pc.addTransceiver('audio', { direction: 'recvonly' })

        // ── 2. When video/audio track arrives → attach to <video> ───────────
        pc.ontrack = (e) => {
          if (closed || !videoRef.current || !e.streams[0]) return
          videoRef.current.srcObject = e.streams[0]
          videoRef.current.play().catch(() => {})
          setConnected(true)
          reconnectAttempts.current = 0 // Reset on successful connection
          setRetrying(false)
        }

        // ── 3. Send ICE candidates to OME via WebSocket ──────────────────────
        pc.onicecandidate = (e) => {
          if (e.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              command:      'candidate',
              candidate:    e.candidate.candidate,
              sdpMid:       e.candidate.sdpMid,
              sdpMLineIndex: e.candidate.sdpMLineIndex,
            }))
          }
        }

        // ── 4. Handle connection state changes ───────────────────────────────
        pc.onconnectionstatechange = () => {
          console.log(`[WebRTC] Connection state: ${pc.connectionState}`)
          if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
            if (!closed) {
              setConnected(false)
              // Only auto-reconnect on disconnected/failed, not on closed (manual cleanup)
              if (pc.connectionState !== 'closed' && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
                scheduleReconnect()
              } else if (reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) {
                setError(`Connection lost (${MAX_RECONNECT_ATTEMPTS} reconnect attempts failed)`)
              }
            }
          }
        }

        pc.oniceconnectionstatechange = () => {
          console.log(`[WebRTC] ICE state: ${pc.iceConnectionState}`)
        }

        // ── 5. Open WebSocket to OME signalling ────────────────────────────
        const ws = new WebSocket(serverUrl)
        wsRef.current = ws

        ws.onopen = () => {
<<<<<<< HEAD
          if (closed) {
            ws.close()
            return
          }
=======
          if (closed) { ws.close(); return }
          console.log('[WebSocket] Connected')
>>>>>>> 78912786884fc3d26ad130e4c125a00250d76595
          ws.send(JSON.stringify({ command: 'request_offer' }))
        }

        ws.onmessage = async (evt) => {
          if (closed) return
<<<<<<< HEAD

          const msg = JSON.parse(evt.data)

          // Handle offer
          if ((msg.command === 'offer' || msg.type === 'offer') && msg.sdp && !answerSent) {
            answerSent = true

            await pc.setRemoteDescription(new RTCSessionDescription({
              type: 'offer',
              sdp: msg.sdp.sdp || msg.sdp,
            }))

            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)

            ws.send(JSON.stringify({
              command: 'answer',
              id: msg.id,
              peer_id: msg.peer_id,
              sdp: { type: 'answer', sdp: answer.sdp },
            }))
          }

          // Handle ICE candidates
          if (Array.isArray(msg.candidates)) {
            for (const c of msg.candidates) {
              try {
                await pc.addIceCandidate(new RTCIceCandidate(c))
              } catch {}
=======
          try {
            const msg = JSON.parse(evt.data)

            // OME sends an SDP offer → we answer it
            if ((msg.command === 'offer' || msg.type === 'offer') && msg.sdp && !answerSent) {
              answerSent = true
              await pc.setRemoteDescription(new RTCSessionDescription({
                type: 'offer',
                sdp:  msg.sdp.sdp || msg.sdp,
              }))
              const answer = await pc.createAnswer()
              await pc.setLocalDescription(answer)
              ws.send(JSON.stringify({
                command:  'answer',
                id:       msg.id,
                peer_id:  msg.peer_id,
                sdp:      { type: 'answer', sdp: answer.sdp },
              }))
>>>>>>> 78912786884fc3d26ad130e4c125a00250d76595
            }

            // OME may batch-send ICE candidates
            if (Array.isArray(msg.candidates)) {
              for (const c of msg.candidates) {
                try { await pc.addIceCandidate(new RTCIceCandidate(c)) } catch {}
              }
            }
          } catch (e) {
            console.error('[WebSocket] Message parse error:', e)
          }
        }

<<<<<<< HEAD
        ws.onerror = () => {
          if (!closed) setError('WebSocket connection failed')
        }

        ws.onclose = () => {
          if (!closed) setConnected(false)
        }

=======
        ws.onerror = (e) => {
          console.error('[WebSocket] Error:', e)
          if (!closed && pc.connectionState !== 'connected' && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
            setError('WebSocket connection failed')
            scheduleReconnect()
          }
        }

        ws.onclose = () => {
          console.log('[WebSocket] Closed')
          if (!closed && pc.connectionState !== 'connected' && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
            scheduleReconnect()
          }
        }
>>>>>>> 78912786884fc3d26ad130e4c125a00250d76595
      } catch (e) {
        console.error('[WebRTCPlayer] Error:', e)
        setError(String(e))
        if (!closed && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
          scheduleReconnect()
        }
      }
    }

    const scheduleReconnect = () => {
      if (closed || reconnectAttempts.current >= MAX_RECONNECT_ATTEMPTS) return
      reconnectAttempts.current++
      const delay = getReconnectDelay()
      console.log(`[WebRTCPlayer] Reconnect attempt ${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`)
      setRetrying(true)
      reconnectTimeoutRef.current = setTimeout(() => {
        if (!closed) start()
      }, delay)
    }



    start()

    // ── CLEANUP ───────────────────────────────────────────────────
    return () => {
      closed = true
      setConnected(false)
<<<<<<< HEAD

      if (videoRef.current) {
        videoRef.current.srcObject = null
      }

=======
      setRetrying(false)
      clearTimeout(reconnectTimeoutRef.current)
      if (videoRef.current) videoRef.current.srcObject = null
>>>>>>> 78912786884fc3d26ad130e4c125a00250d76595
      wsRef.current?.close()
      pcRef.current?.close()

      // ✅ REMOVE FROM ACTIVE STREAMS
      if (serverUrl) {
        activeStreams.delete(serverUrl)
      }
    }

  }, [serverUrl])

  // ── UI ──────────────────────────────────────────────────────────
  const wrapStyle = {
    position: 'relative',
    width: '100%',
    height: '100%',
    background: '#000',
    borderRadius: 6,
    overflow: 'hidden',
  }

  const centreStyle = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    gap: 8,
  }

  return (
    <div style={wrapStyle}>
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />

      {/* CONNECTING */}
      {!connected && !error && (
        <div style={centreStyle}>
          <span style={{ fontSize: 11, color: '#94a3b8', letterSpacing: 1 }}>
            ● CONNECTING…
          </span>
        </div>
      )}

<<<<<<< HEAD
      {/* ERROR */}
=======
      {/* RETRYING state */}
      {retrying && !error && (
        <div style={centreStyle}>
          <span style={{ fontSize: 12, color: '#f59e0b', letterSpacing: 1 }}>
            ⟳ RECONNECTING…
          </span>
          <span style={{ fontSize: 9, color: '#78716c' }}>
            Attempt {reconnectAttempts.current}
          </span>
        </div>
      )}

      {/* ERROR state */}
>>>>>>> 78912786884fc3d26ad130e4c125a00250d76595
      {error && (
        <div style={centreStyle}>
          <span style={{ color: '#ef4444', fontSize: 20 }}>⚠</span>
          <span style={{ color: '#94a3b8', fontSize: 11, textAlign: 'center', maxWidth: '80%' }}>
            {error}
          </span>
          {reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS && (
            <span style={{ color: '#78716c', fontSize: 9, marginTop: 8 }}>
              Auto-reconnecting...
            </span>
          )}
        </div>
      )}

      {/* LIVE */}
      {connected && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: 8,
          background: 'rgba(0,0,0,.6)',
          padding: '2px 7px',
          borderRadius: 3,
          fontSize: 10,
          color: '#22c55e',
          letterSpacing: 1,
        }}>
          ● LIVE
        </div>
      )}
    </div>
  )
}

export default memo(WebRTCPlayer)