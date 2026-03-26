import { useState, useRef, useEffect } from "react";
import { useAuth } from "../../context/AuthContext";
import "./MediaPlayerPage.css";

// Pointer to the local Flask server in player_mirador
const FLASK_API = "http://127.0.0.1:8000";

function loadDevices() {
  try { return JSON.parse(localStorage.getItem("miradorai_devices") || "[]"); }
  catch { return []; }
}

export default function MediaPlayerPage() {
  const { user } = useAuth();

  // ── States ──────────────────────────────────────────────────────
  const [mode, setMode]               = useState("recordings"); // recordings | live | rtsp
  const [cameras]                     = useState(loadDevices);
  const [recordingCameras, setRecordingCameras] = useState([]);
  const [selectedCam, setSelectedCam] = useState(null);
  const [files, setFiles]             = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [playingFile, setPlayingFile] = useState(null);
  const [rtspUrl, setRtspUrl]         = useState("");
  const [selectedCustomFile, setSelectedCustomFile] = useState(null);
  const [playing, setPlaying]         = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration]       = useState(0);
  const [volume, setVolume]           = useState(0.8);
  const [speed, setSpeed]             = useState(1);
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0]
  );

  const videoRef    = useRef(null);
  const playerWrap  = useRef(null);
  const fileInputRef = useRef(null);

  // ── Video Events ────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime     = () => setCurrentTime(v.currentTime);
    const onDuration = () => setDuration(v.duration);
    const onPlay     = () => setPlaying(true);
    const onPause    = () => setPlaying(false);
    const onEnded    = () => { setPlaying(false); };
    v.addEventListener("timeupdate",      onTime);
    v.addEventListener("loadedmetadata",  onDuration);
    v.addEventListener("play",            onPlay);
    v.addEventListener("pause",           onPause);
    v.addEventListener("ended",           onEnded);
    return () => {
      v.removeEventListener("timeupdate",     onTime);
      v.removeEventListener("loadedmetadata", onDuration);
      v.removeEventListener("play",           onPlay);
      v.removeEventListener("pause",          onPause);
      v.removeEventListener("ended",          onEnded);
    };
  }, [playingFile]);

  useEffect(() => { if (videoRef.current) videoRef.current.volume = volume; }, [volume]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = speed; }, [speed]);

  // ── Decryption Logic (Local Flask Bridge) ───────────────────────
  const handleFileSelection = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // If it's an .enc file, we must decrypt via Flask
    if (file.name.endsWith(".enc")) {
      const formData = new FormData();
      formData.append("file", file);
      
      setLoadingFiles(true);
      fetch(`${FLASK_API}/play`, {
        method: "POST",
        body: formData,
      })
        .then((res) => {
          if (!res.ok) throw new Error(`Decryption failed: ${res.status}`);
          return res.blob();
        })
        .then((decryptedBlob) => {
          const fileUrl = URL.createObjectURL(decryptedBlob);
          const decryptedFile = {
            name: file.name,
            url: fileUrl,
            size: (file.size / (1024 * 1024)).toFixed(2) + " MB",
            isCustom: true,
            isEncrypted: true,
          };
          setSelectedCustomFile(decryptedFile);
          setPlayingFile(decryptedFile);
          
          setTimeout(() => {
            if (videoRef.current) {
              videoRef.current.load();
              videoRef.current.play().catch(() => {});
            }
          }, 100);
        })
        .catch((err) => {
          console.error("Failed to decrypt file:", err);
          alert("Failed to decrypt .enc file. Make sure your local Flask server (api_player.py) is running on port 8000 and the video.key is correct.");
        })
        .finally(() => setLoadingFiles(false));
    } else {
      // Normal video file
      const fileUrl = URL.createObjectURL(file);
      const customFile = {
        name: file.name,
        url: fileUrl,
        size: (file.size / (1024 * 1024)).toFixed(2) + " MB",
        isCustom: true,
      };
      setSelectedCustomFile(customFile);
      setPlayingFile(customFile);
      
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.load();
          videoRef.current.play().catch(() => {});
        }
      }, 100);
    }
  };

  // ── Actions ─────────────────────────────────────────────────────
  const togglePlay = () => {
    if (!videoRef.current) return;
    playing ? videoRef.current.pause() : videoRef.current.play();
  };

  const seek = (e) => {
    if (!videoRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    videoRef.current.currentTime = pct * duration;
  };

  const skip = (secs) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, Math.min(duration, currentTime + secs));
  };

  const toggleFullscreen = () => {
    if (!playerWrap.current) return;
    if (!document.fullscreenElement) {
      playerWrap.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  const fmt = (s) => {
    if (!s || isNaN(s)) return "00:00";
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`
      : `${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  };

  const displayDate = new Date(selectedDate).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).replace(/\//g, " / ");

  return (
    <div className="mp-shell">
      {/* ── Top Breadcrumb / Status Row ── */}
      <div className="mp-top-bar">
        <div className="mp-breadcrumb">
          <button className="mp-add-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
          <span className="mp-brand">MIRADOR VMS</span>
          <span className="mp-sep">{">"}</span>
        </div>
        <div className="mp-top-right">
          <div className="mp-status-item"><span className="dot online"/> 0 Cameras</div>
          <div className="mp-status-item"><span className="dot alarm"/> 3 Alarms <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10"><path d="M6 9l6 6 6-6"/></svg></div>
          <div className="mp-user-pill">
            <div className="mp-avatar">A</div>
            Admin
          </div>
        </div>
      </div>

      <div className="mp-main-content">
        {/* ── Left Sidebar: Media Browser ── */}
        <aside className="mp-left">
          <div className="mp-panel-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <rect x="2" y="2" width="20" height="8" rx="2"/>
              <rect x="2" y="14" width="20" height="8" rx="2"/>
            </svg>
            Media Browser
          </div>

          <div className="mp-tabs">
            {["recordings", "live", "rtsp"].map(t => (
              <button key={t} className={`mp-tab ${mode === t ? "active" : ""}`} onClick={() => setMode(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          <div className="mp-section-title">RECORDED CAMERAS</div>
          <div className="mp-empty-state">No cameras with recordings</div>

          <div className="mp-date-display">
            <span>{displayDate}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
          </div>

          <div className="mp-storage-section">
            <div className="mp-storage-header">
              <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
              </svg>
              Open from Storage
            </div>
            <div className="mp-file-picker">
              <button className="mp-browse-btn" onClick={() => fileInputRef.current?.click()}>Browse...</button>
              <span className="mp-file-name">{selectedCustomFile ? selectedCustomFile.name : "No file selected."}</span>
              <input type="file" ref={fileInputRef} onChange={handleFileSelection} hidden accept=".enc,.mp4" />
            </div>
          </div>

          <div className="mp-empty-state bottom">No recordings for this date</div>
        </aside>

        {/* ── Center: Player ── */}
        <main className="mp-center">
          <div className="mp-player-container" ref={playerWrap}>
            {!playingFile ? (
              <div className="mp-player-placeholder">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" width="64" height="64">
                  <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
                <p>Select a recording to play</p>
              </div>
            ) : (
              <video ref={videoRef} className="mp-video" src={playingFile.url} autoPlay />
            )}
          </div>

          <div className="mp-bottom-controls">
            <div className="mp-timeline-row">
              <span className="mp-time-label">{fmt(currentTime)}</span>
              <div className="mp-seek-bar" onClick={seek}>
                <div className="mp-seek-fill" style={{ width: `${(currentTime/duration)*100 || 0}%` }} />
                <div className="mp-seek-knob" style={{ left: `${(currentTime/duration)*100 || 0}%` }} />
              </div>
              <span className="mp-time-label">{fmt(duration)}</span>
            </div>

            <div className="mp-actions-row">
              <div className="mp-actions-left">
                <button className="mp-icon-btn"><svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg></button>
                <button className="mp-icon-btn" onClick={() => (videoRef.current.currentTime = 0)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 .49-3.54"/></svg></button>
                <button className="mp-play-pause" onClick={togglePlay}>
                  {playing ? <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg> : <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5v14l11-7z"/></svg>}
                </button>
                <button className="mp-icon-btn" onClick={() => skip(10)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-.49-3.54"/></svg></button>
                <button className="mp-icon-btn"><svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M13 6v12l8.5-6L13 6zM4 18l8.5-6L4 6v12z"/></svg></button>
              </div>

              <div className="mp-actions-right">
                <div className="mp-volume-ctrl">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                  <input type="range" className="mp-vol-slider" min="0" max="1" step="0.01" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} />
                </div>
                <div className="mp-speed-group">
                  {[1, 2, 4].map(s => (
                    <button key={s} className={`mp-speed-btn ${speed === s ? "active" : ""}`} onClick={() => setSpeed(s)}>{s}x</button>
                  ))}
                </div>
                <button className="mp-icon-btn" onClick={toggleFullscreen}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                </button>
              </div>
            </div>
          </div>
        </main>

        {/* ── Right Sidebar: Timeline ── */}
        <aside className="mp-right">
          <div className="mp-panel-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            Timeline
          </div>
          <div className="mp-timeline-date-nav">
            <button className="mp-nav-btn">{"<"}</button>
            <span className="mp-date-text">26 Mar 2026</span>
            <button className="mp-nav-btn">{">"}</button>
          </div>
          <div className="mp-timeline-list">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="mp-timeline-hour">
                <span className="hour-text">{String(i).padStart(2, "0")}:00</span>
                <div className="hour-track" />
              </div>
            ))}
          </div>
          <div className="mp-quick-stream">
            <div className="mp-qs-head">QUICK STREAM</div>
            <input className="mp-qs-input" placeholder="rtsp://..." />
            <button className="mp-qs-play">
              <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M8 5v14l11-7z"/></svg> Play
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
