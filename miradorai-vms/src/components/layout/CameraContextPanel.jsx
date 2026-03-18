import { CAMERA_FEATURES_CONFIG } from "../../data/navConfig";
import "./CameraContextPanel.css";

function SvgIcon({ html }) {
  return <span className="camera-feature-icon" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function CameraContextPanel({ camera, onNavigate, onClose, activePage }) {
  if (!camera) return null;

  return (
    <div className="camera-context-panel">
      {/* Header with camera info and close button */}
      <div className="camera-context__header">
        <div className="camera-context__camera-info">
          <div className="camera-context__camera-name">{camera.name || "Camera"}</div>
          <div className="camera-context__camera-status">Connected</div>
        </div>
        <button className="camera-context__close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Features grid for this camera */}
      <div className="camera-context__features">
        <div className="camera-context__features-title">Camera Features</div>
        <div className="camera-context__features-grid">
          {CAMERA_FEATURES_CONFIG.map((feature) => {
            const isActive = activePage === feature.page;
            return (
              <button
                key={feature.page}
                className={`camera-feature-btn ${isActive ? "camera-feature-btn--active" : ""}`}
                onClick={() => {
                  onNavigate(feature.page);
                  // Keep panel open for context
                }}
                title={feature.label}
              >
                <SvgIcon html={feature.icon} />
                <span className="camera-feature-label">{feature.label}</span>
                {isActive && <span className="camera-feature-dot" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Call to action for viewing camera in live view */}
      <div className="camera-context__footer">
        <button
          className="camera-context__live-view-btn"
          onClick={() => onNavigate("live-view")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 7l-7 5 7 5V7z" />
            <rect x="1" y="5" width="15" height="14" rx="2" />
          </svg>
          View in Live View
        </button>
      </div>
    </div>
  );
}
