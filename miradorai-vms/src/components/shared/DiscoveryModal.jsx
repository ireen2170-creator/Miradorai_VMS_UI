import { useState, useEffect } from "react";
import "./DiscoveryModal.css";

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

  useEffect(() => {
    if (isOpen) {
      startDiscovery();
    } else {
      setDiscoveredDevices([]);
      setSelectedDevices(new Set());
      setIsScanning(false);
      setProgress(0);
      setStatusMessage("Initializing network scan...");
      setHasScanned(false);
      setError(null);
    }
  }, [isOpen]);

  // Simulate network discovery
  const startDiscovery = async () => {
    setIsScanning(true);
    setError(null);
    setDiscoveredDevices([]);
    setSelectedDevices(new Set());
    setProgress(0);
    setHasScanned(false);

    try {
      // Simulate scanning progress
      setStatusMessage("Scanning network for ONVIF devices...");
      
      for (let i = 0; i <= 100; i += 10) {
        setProgress(i);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      // Try to call backend API with credentials
      let devices = [];
      try {
        const params = new URLSearchParams();
        if (username) params.append('username', username);
        if (password) params.append('password', password);
        
        const url = `http://localhost:8000/api/discover-devices${params.toString() ? '?' + params.toString() : ''}`;
        
        const response = await fetch(url, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        if (response.ok) {
          const data = await response.json();
          const incoming = data.devices || [];

          // Normalize IP and dedupe by exact IP (office cam vs others)
          const normalized = incoming.map((dev) => {
            let ip = dev.ip || "";
            if (!ip && dev.stream_uri) {
              try {
                ip = new URL(dev.stream_uri).hostname;
              } catch {}
            }
            if (!ip && dev.rtsp_url) {
              try {
                ip = new URL(dev.rtsp_url).hostname;
              } catch {}
            }
            return {
              ...dev,
              ip,
              name: dev.name || `${ip || "Unknown"} · ${dev.manufacturer || "Unknown"}`,
            };
          });

          const uniqueByIp = Object.values(
            normalized.reduce((acc, item) => {
              if (!item.ip) return acc;
              acc[item.ip] = acc[item.ip]
                ? { ...acc[item.ip], ...item }
                : item;
              return acc;
            }, {})
          );

          devices = uniqueByIp;
          console.log("[Discovery] Backend normalized devices:", devices);
        } else {
          console.log("[Discovery] Backend returned non-OK status:", response.status);
        }
      } catch (fetchErr) {
        console.log("[Discovery] Backend API failed:", fetchErr.message);
      }

      setDiscoveredDevices(devices);
      setStatusMessage(
        `Found ${devices.length} camera${devices.length !== 1 ? "s" : ""}`
      );
      setProgress(100);
      setHasScanned(true);
    } catch (err) {
      setError(err.message || "Failed to discover devices");
      setStatusMessage("Scan failed");
      setHasScanned(true);
    } finally {
      setIsScanning(false);
    }
  };

  const getMockDevices = () => [
    {
      id: "device-1",
      name: "Front Entrance Camera",
      ip: "192.168.1.50",
      mac: "00:1A:2B:3C:4D:5E",
      manufacturer: "Hikvision",
      model: "DS-2CD2143G0-I",
      status: "online",
    },
    {
      id: "device-2",
      name: "Lobby Camera",
      ip: "192.168.1.51",
      mac: "00:1A:2B:3C:4D:5F",
      manufacturer: "Dahua",
      model: "IPC-HDBW2433E-Z",
      status: "online",
    },
    {
      id: "device-3",
      name: "Back Door Camera",
      ip: "192.168.1.52",
      mac: "00:1A:2B:3C:4D:60",
      manufacturer: "Uniview",
      model: "IPC312SR-DVSPF",
      status: "offline",
    },
    {
      id: "device-4",
      name: "Parking Lot Camera",
      ip: "192.168.1.53",
      mac: "00:1A:2B:3C:4D:61",
      manufacturer: "Hikvision",
      model: "DS-2CD3T47FWDV",
      status: "online",
    },
  ];

  const toggleDeviceSelection = (id) => {
    const newSelected = new Set(selectedDevices);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedDevices(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedDevices.size === discoveredDevices.length) {
      setSelectedDevices(new Set());
    } else {
      setSelectedDevices(new Set(discoveredDevices.map((d) => d.id)));
    }
  };

  const handleAddDevices = () => {
    const devicesToAdd = discoveredDevices.filter((d) => selectedDevices.has(d.id));
    onAddDevices(devicesToAdd);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="discovery-overlay" onClick={onClose}>
      <div className="discovery-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="discovery-header">
          <div className="discovery-title">Network Discovery</div>
          <button className="discovery-close" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="discovery-content">
          {!hasScanned && !isScanning ? (
            // Initial state - show start button
            <div className="discovery-empty">
              <svg
                className="discovery-empty-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
                <path d="M11 8v6M8 11h6" />
              </svg>
              <div className="discovery-empty-title">Auto-Discover Cameras</div>
              <div className="discovery-empty-desc">
                Scan your network for available ONVIF-compatible cameras.
                <br />
                This typically takes 20-30 seconds.
              </div>
              
              <div className="discovery-credentials">
                <label className="discovery-cred-label">
                  <span>Username (optional)</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="admin"
                    className="discovery-cred-input"
                  />
                </label>
                <label className="discovery-cred-label">
                  <span>Password (optional)</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="password"
                    className="discovery-cred-input"
                  />
                </label>
              </div>
              
              <button className="discovery-start-btn" onClick={startDiscovery}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Start Discovery
              </button>
            </div>
          ) : isScanning ? (
            // Scanning state
            <div className="discovery-scanning">
              <div className="discovery-spinner">
                <div className="discovery-spinner-ring"></div>
              </div>
              <div className="discovery-status-message">{statusMessage}</div>
              <div className="discovery-progress-container">
                <div className="discovery-progress-bar">
                  <div className="discovery-progress-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="discovery-progress-text">{progress}%</div>
              </div>
            </div>
          ) : discoveredDevices.length > 0 ? (
            // Results state
            <div className="discovery-results">
              <div className="discovery-results-header">
                <div className="discovery-results-title">
                  Found {discoveredDevices.length} Camera{discoveredDevices.length !== 1 ? "s" : ""}
                </div>
                <button
                  className="discovery-select-all"
                  onClick={toggleSelectAll}
                >
                  {selectedDevices.size === discoveredDevices.length ? "Deselect All" : "Select All"}
                </button>
              </div>

              <div className="discovery-device-list">
                {discoveredDevices.map((device) => (
                  <div
                    key={device.id}
                    className={`discovery-device-item ${selectedDevices.has(device.id) ? "selected" : ""}`}
                  >
                    <input
                      type="checkbox"
                      className="discovery-device-checkbox"
                      checked={selectedDevices.has(device.id)}
                      onChange={() => toggleDeviceSelection(device.id)}
                    />
                    <div className="discovery-device-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="7" width="15" height="10" rx="2" />
                        <path d="M17 9l5-3v12l-5-3" />
                      </svg>
                    </div>
                    <div className="discovery-device-info">
                      <div className="discovery-device-name">{device.name}</div>
                      <div className="discovery-device-details">
                        {device.ip} • {device.manufacturer} {device.model}
                      </div>
                    </div>
                    <div className={`discovery-device-status ${device.status}`}>
                      <span className={`discovery-status-dot ${device.status}`}></span>
                      {device.status === "online" ? "Online" : "Offline"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            // Error or no devices found
            <div className="discovery-empty">
              <svg
                className="discovery-empty-icon warning"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <div className="discovery-empty-title">
                {error ? "Discovery Failed" : "No Cameras Found"}
              </div>
              <div className="discovery-empty-desc">
                {error
                  ? `Error: ${error}`
                  : "No ONVIF cameras detected on your network."}
              </div>
              <button className="discovery-start-btn" onClick={startDiscovery}>
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Try Again
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        {discoveredDevices.length > 0 && !isScanning && (
          <div className="discovery-footer">
            <button className="discovery-btn discovery-btn-cancel" onClick={onClose}>
              Cancel
            </button>
            <button
              className="discovery-btn discovery-btn-primary"
              disabled={selectedDevices.size === 0}
              onClick={handleAddDevices}
            >
              Add {selectedDevices.size > 0 ? `${selectedDevices.size} Camera${selectedDevices.size !== 1 ? "s" : ""}` : "Devices"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
