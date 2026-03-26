import "./MediaPlayerPage.css";

export default function MediaPlayerPage() {
  return (
    <div className="media-player-page">
      <div className="media-player-container">
        <div className="media-player-header">
          <h1>Media Player</h1>
          <p>Admin Only Feature</p>
        </div>

        <div className="media-player-content">
          <div className="media-player-placeholder">
            <svg
              viewBox="0 0 64 64"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <rect x="8" y="12" width="48" height="36" rx="2" />
              <path d="M28 32l12-8v16l-12-8z" />
            </svg>
            <h2>Media Player Component</h2>
            <p>
              Your encrypted video file player will be integrated here.
            </p>
            <p className="text-muted">
              This is a placeholder for your custom media player implementation.
            </p>
          </div>
        </div>

        <div className="media-player-info">
          <div className="info-card">
            <div className="info-icon">📁</div>
            <div className="info-text">
              <h3>Supported Formats</h3>
              <p>Ready for encrypted video files</p>
            </div>
          </div>
          <div className="info-card">
            <div className="info-icon">🔐</div>
            <div className="info-text">
              <h3>Encryption Support</h3>
              <p>Secure playback of encrypted content</p>
            </div>
          </div>
          <div className="info-card">
            <div className="info-icon">⚙️</div>
            <div className="info-text">
              <h3>Customizable</h3>
              <p>Replace with your own implementation</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}