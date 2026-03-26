import { useState } from "react";
import "./DiscoveryModal.css";

const STREAM_API = "http://localhost:8000";

export default function DiscoveryModal({ isOpen, onClose, onAddDevices }) {
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [selectedDevices, setSelectedDevices] = useState(new Set());
  const [isScanning, setIsScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState("Initializing network scan...");
  const [error, setError] = useState(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Simulate network discovery
  const startDiscovery = async () => {
    setIsScanning(true);
    setError(null);
    setDiscoveredDevices([]);
    setSelectedDevices(new Set());
    setRegStatus({});
    setDeviceCreds({});
    setProgress(0);
    setHasScanned(false);

    try {
      setStatusMessage("Scanning network for ONVIF cameras…");

      // Animate progress while waiting
      for (let i = 0; i <= 60; i += 10) {
        setProgress(i);
        await new Promise((r) => setTimeout(r, 300));
      }

      // No params — backend uses WS-Discovery multicast + env subnet fallback
      const response = await fetch(`${STREAM_API}/api/discover-devices`);
      setProgress(90);

        if (response.ok) {
          const data = await response.json();
          devices = data.devices || [];
          console.log("[Discovery] Backend returned:", devices);
        } else {
          console.log("[Discovery] Backend returned non-OK status:", response.status);
        }
      } catch (fetchErr) {
        console.log("[Discovery] Backend API failed:", fetchErr.message);
      }

      setDiscoveredDevices(devices);
      setStatusMessage(
        `Found ${data.devices?.length || 0} camera${data.devices?.length !== 1 ? "s" : ""}`
      );
      setProgress(100);
      setHasScanned(true);
      setIsScanning(false);
    }
  };

  // ── Selection ────────────────────────────────────────────────────
  const toggleOne = (id) => {
    const s = new Set(selectedDevices);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelectedDevices(s);
  };

  const toggleAll = () => {
    setSelectedDevices(
      selectedDevices.size === discoveredDevices.length
        ? new Set()
        : new Set(discoveredDevices.map((d) => d.id))
    );
  };

  // ── "Add Cameras" → open credential popup ────────────────────────
  const handleAddClick = () => {
    const init = {};
    discoveredDevices
      .filter((d) => selectedDevices.has(d.id))
      .forEach((d) => {
        init[d.id] = deviceCreds[d.id] || { username: "", password: "" };
      });
    setDeviceCreds(init);
    setShowCredModal(true);
  };

  const updateCred = (deviceId, field, value) => {
    setDeviceCreds((prev) => ({
      ...prev,
      [deviceId]: { ...prev[deviceId], [field]: value },
    }));
  };

  // ── Enroll & Stream ───────────────────────────────────────────────
  const handleEnroll = async () => {
    setShowCredModal(false);
    const toAdd = discoveredDevices.filter((d) => selectedDevices.has(d.id));
    setIsRegistering(true);

    const initStatus = {};
    toAdd.forEach((d) => { initStatus[d.id] = { status: "pending" }; });
    setRegStatus(initStatus);

    const results = await Promise.all(
      toAdd.map(async (device) => {
        const creds       = deviceCreds[device.id] || {};
        const rtsp        = device.rtsp_url || device.stream_uri || "";
        let ws_url        = null;
        let stream_key    = null;
        let stream_status = "error";

        setRegStatus((prev) => ({ ...prev, [device.id]: { status: "registering" } }));

        try {
          const res = await fetch(`${STREAM_API}/api/streams/register`, {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rtsp_url:     rtsp,
              ip:           device.ip           || "",
              port:         device.port         || 80,
              username:     creds.username      || "",
              password:     creds.password      || "",
              manufacturer: device.manufacturer || "Unknown",
              model:        device.model        || "Unknown",
              mac:          device.mac          || "—",
              device_name:  device.name         || `Camera @ ${device.ip}`,
            }),
          });

          const data = res.ok ? await res.json() : null;

          if (data?.success && data?.ws_url) {
            ws_url        = data.ws_url;
            stream_key    = data.stream_key || data.ome_stream || null;
            stream_status = data.status     || "streaming";
            setRegStatus((prev) => ({ ...prev, [device.id]: { status: "success", ws_url } }));
          } else {
            const errMsg = data?.error || (res.ok ? "No ws_url in response" : `HTTP ${res.status}`);
            setRegStatus((prev) => ({ ...prev, [device.id]: { status: "error", error: errMsg } }));
          }
        } catch (err) {
          setRegStatus((prev) => ({ ...prev, [device.id]: { status: "error", error: err.message } }));
        }

        return {
          id:            `device-${device.ip}-${Date.now()}`,
          type:          "entrance",
          name:          device.name || `Camera @ ${device.ip}`,
          ip:            device.ip,
          mac:           device.mac          || "—",
          status:        ws_url ? "Online" : "Offline",
          manufacturer:  device.manufacturer || "Unknown",
          model:         device.model        || "Unknown",
          rtsp_url:      rtsp || null,
          ws_url,
          stream_key,
          stream_status,
          source:        "discovery",
        };
      })
    );

    await new Promise((r) => setTimeout(r, 800));
    setIsRegistering(false);
    onAddDevices(results);
    onClose();
  };

  // ── Status badge ──────────────────────────────────────────────────
  const RegBadge = ({ deviceId }) => {
    const s = regStatus[deviceId];
    if (!s) return null;
    const map = {
      pending:     { label: "Pending…",    cls: "dm-reg--pending"  },
      registering: { label: "Probing…",    cls: "dm-reg--progress" },
      success:     { label: "✓ Streaming", cls: "dm-reg--success"  },
      error:       { label: "✗ Failed",    cls: "dm-reg--error"    },
    };
    const { label, cls } = map[s.status] || {};
    return (
      <span className={`dm-reg-badge ${cls}`} title={s.error || s.ws_url || ""}>
        {label}
      </span>
    );
  };

  const selectedList = discoveredDevices.filter((d) => selectedDevices.has(d.id));

  // ── Render ────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Discovery modal ── */}
      <div className="dm-overlay" onClick={onClose}>
        <div className="dm-modal" onClick={(e) => e.stopPropagation()}>

          <div className="dm-header">
            <div className="dm-header-left">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
                <path d="M11 8v6M8 11h6"/>
              </svg>
              Network Discovery
            </div>
            <button className="dm-close" onClick={onClose}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className="dm-body">

            {/* Initial */}
            {!hasScanned && !isScanning && (
              <div className="dm-center">
                <div className="dm-empty-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="32" height="32">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                    <path d="M2 12h20"/>
                  </svg>
                </div>
                <div className="dm-empty-title">Auto-Discover Cameras</div>
                <div className="dm-empty-sub">
                  Automatically scans your network for ONVIF-compatible cameras.
                  <br />No configuration needed — just click Start.
                </div>
                <button className="dm-start-btn" onClick={startDiscovery}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Start Discovery
                </button>
              </div>
            )}

            {/* Scanning */}
            {isScanning && (
              <div className="dm-center">
                <div className="dm-spinner"><div className="dm-spinner-ring"/></div>
                <div className="dm-scan-msg">{statusMessage}</div>
                <div className="dm-progress-wrap">
                  <div className="dm-progress-bar">
                    <div className="dm-progress-fill" style={{ width: `${progress}%` }}/>
                  </div>
                  <span className="dm-progress-pct">{progress}%</span>
                </div>
              </div>
            )}

            {/* Results */}
            {hasScanned && !isScanning && discoveredDevices.length > 0 && (
              <div className="dm-results">
                <div className="dm-results-header">
                  <span className="dm-results-count">
                    Found <strong>{discoveredDevices.length}</strong> camera{discoveredDevices.length !== 1 ? "s" : ""}
                  </span>
                  <button className="dm-select-all" onClick={toggleAll} disabled={isRegistering}>
                    {selectedDevices.size === discoveredDevices.length ? "Deselect All" : "Select All"}
                  </button>
                </div>
                <div className="dm-device-list">
                  {discoveredDevices.map((device) => {
                    const sel = selectedDevices.has(device.id);
                    return (
                      <div
                        key={device.id}
                        className={`dm-device ${sel ? "dm-device--selected" : ""} ${isRegistering ? "dm-device--disabled" : ""}`}
                        onClick={() => !isRegistering && toggleOne(device.id)}
                      >
                        <input
                          type="checkbox"
                          className="dm-cb"
                          checked={sel}
                          disabled={isRegistering}
                          onChange={() => toggleOne(device.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div className="dm-device-icon">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
                            <rect x="2" y="7" width="15" height="10" rx="2"/>
                            <path d="M17 9l5-3v12l-5-3"/>
                          </svg>
                        </div>
                        <div className="dm-device-info">
                          <div className="dm-device-name">{device.name || `Camera @ ${device.ip}`}</div>
                          <div className="dm-device-meta">
                            {device.ip}
                            {device.manufacturer && device.manufacturer !== "Unknown" && ` · ${device.manufacturer}`}
                            {device.model        && device.model !== "Unknown"        && ` ${device.model}`}
                          </div>
                        </div>
                        {isRegistering && sel
                          ? <RegBadge deviceId={device.id} />
                          : (
                            <div className={`dm-status ${device.status === "online" ? "dm-status--online" : "dm-status--offline"}`}>
                              <span className="dm-status-dot"/>
                              {device.status === "online" ? "Online" : "Offline"}
                            </div>
                          )
                        }
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* No results */}
            {hasScanned && !isScanning && discoveredDevices.length === 0 && (
              <div className="dm-center">
                <div className="dm-empty-icon dm-empty-icon--warn">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <div className="dm-empty-title">{error ? "Discovery Failed" : "No Cameras Found"}</div>
                <div className="dm-empty-sub">
                  {error || "No ONVIF cameras were detected on the network."}
                </div>
                <button className="dm-start-btn" onClick={startDiscovery}>
                  <svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
                  Try Again
                </button>
              </div>
            )}
          </div>

          {hasScanned && !isScanning && discoveredDevices.length > 0 && (
            <div className="dm-footer">
              <button className="dm-btn dm-btn--cancel" onClick={onClose} disabled={isRegistering}>
                Cancel
              </button>
              <button
                className="dm-btn dm-btn--primary"
                disabled={selectedDevices.size === 0 || isRegistering}
                onClick={handleAddClick}
              >
                {isRegistering
                  ? "Registering…"
                  : selectedDevices.size > 0
                    ? `Add ${selectedDevices.size} Camera${selectedDevices.size !== 1 ? "s" : ""}`
                    : "Add Devices"
                }
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Credential enrollment modal ── */}
      {showCredModal && (
        <div className="dm-overlay dm-overlay--front" onClick={() => setShowCredModal(false)}>
          <div className="dm-cred-modal" onClick={(e) => e.stopPropagation()}>

            <div className="dm-header">
              <div className="dm-header-left">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                  <rect x="3" y="11" width="18" height="11" rx="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                Enter Camera Credentials
              </div>
              <button className="dm-close" onClick={() => setShowCredModal(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div className="dm-cred-body">
              <p className="dm-cred-hint">
                Enter ONVIF credentials for each camera. Leave blank if no authentication is required.
              </p>
              <div className="dm-cred-list">
                {selectedList.map((device) => (
                  <div key={device.id} className="dm-cred-row">
                    <div className="dm-cred-cam">
                      <div className="dm-cred-cam-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="15" height="15">
                          <rect x="2" y="7" width="15" height="10" rx="2"/>
                          <path d="M17 9l5-3v12l-5-3"/>
                        </svg>
                      </div>
                      <div>
                        <div className="dm-cred-cam-name">{device.name || `Camera @ ${device.ip}`}</div>
                        <div className="dm-cred-cam-ip">{device.ip}</div>
                      </div>
                    </div>
                    <div className="dm-cred-fields">
                      <input
                        className="dm-cred-input"
                        placeholder="Username"
                        value={deviceCreds[device.id]?.username || ""}
                        onChange={(e) => updateCred(device.id, "username", e.target.value)}
                        autoComplete="off"
                      />
                      <input
                        className="dm-cred-input"
                        placeholder="Password"
                        type="password"
                        value={deviceCreds[device.id]?.password || ""}
                        onChange={(e) => updateCred(device.id, "password", e.target.value)}
                        autoComplete="new-password"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="dm-footer">
              <button className="dm-btn dm-btn--cancel" onClick={() => setShowCredModal(false)}>
                Back
              </button>
              <button className="dm-btn dm-btn--primary" onClick={handleEnroll}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                Enroll & Stream
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}