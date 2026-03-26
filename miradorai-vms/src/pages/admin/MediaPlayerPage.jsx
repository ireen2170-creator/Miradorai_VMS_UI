import { useRef, useState } from "react";
import "./MediaPlayerPage.css";
//
export default function MediaPlayerPage() {
  const videoRef = useRef(null);

  const [videoUrl, setVideoUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [time, setTime] = useState("00:00:00");

  const handleFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("http://127.0.0.1:8000/play", {
        method: "POST",
        body: formData,
      });

      console.log("STATUS:", res.status);

      if (!res.ok) {
        const text = await res.text();
        console.error("Backend error:", text);
        alert("Decryption failed");
        setLoading(false);
        return;
      }

      const contentType = res.headers.get("content-type");
      console.log("TYPE:", contentType);

      if (!contentType || !contentType.includes("video")) {
        const text = await res.text();
        console.error("Not a video:", text);
        alert("Invalid response");
        setLoading(false);
        return;
      }

      const blob = await res.blob();
      console.log("BLOB SIZE:", blob.size);

      if (blob.size === 0) {
        alert("Empty video received");
        setLoading(false);
        return;
      }

      const url = URL.createObjectURL(blob);
      console.log("VIDEO URL:", url);

      setVideoUrl(url);

      // 🔥 FORCE VIDEO LOAD & PLAY
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.load();
          videoRef.current.play().catch(() => { });
        }
      }, 100);

    } catch (err) {
      console.error("FETCH ERROR:", err);
      alert("Error decrypting");
    }

    setLoading(false);
  };

  const play = () => videoRef.current?.play();
  const pause = () => videoRef.current?.pause();

  const updateTime = () => {
    const v = videoRef.current;
    if (!v) return;

    const current = v.currentTime;
    const duration = v.duration || 1;

    setProgress((current / duration) * 100);

    const h = String(Math.floor(current / 3600)).padStart(2, "0");
    const m = String(Math.floor((current % 3600) / 60)).padStart(2, "0");
    const s = String(Math.floor(current % 60)).padStart(2, "0");

    setTime(`${h}:${m}:${s}`);
  };

  const seek = (e) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = (e.target.value / 100) * v.duration;
  };

  return (
    <div className="media-player-page">

      {/* HEADER */}
      <div className="player-header">
        <h2>Media Player</h2>
        <input type="file" accept=".enc" onChange={handleFile} />
        {loading && <span>Decrypting...</span>}
      </div>

      {/* VIDEO AREA */}
      <div className="video-container">
        {videoUrl ? (
          <video
            ref={videoRef}
            controls
            autoPlay
            playsInline
            muted
            onLoadedMetadata={() => {
              console.log("VIDEO LOADED");
              videoRef.current.play().catch(() => { });
            }}
            onError={(e) => {
              console.error("VIDEO ERROR:", e);
              alert("Video cannot be played (codec issue)");
            }}
            onTimeUpdate={updateTime}
            style={{ width: "100%", height: "100%", background: "black" }}
          >
            <source src={videoUrl} type="video/mp4" />
          </video>
        ) : (
          <div className="no-video">
            No file loaded — select .enc file
          </div>
        )}
      </div>

      {/* CONTROLS */}
      <div className="controls">
        <button onClick={play}>▶</button>
        <button onClick={pause}>⏸</button>

        <input
          type="range"
          value={progress}
          onChange={seek}
        />

        <span>{time}</span>
      </div>

    </div>
  );
}