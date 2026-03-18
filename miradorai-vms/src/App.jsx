
import { useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Sidebar from "./components/layout/Sidebar";
import TopBar from "./components/layout/TopBar";
import PageRenderer from "./components/layout/PageRenderer";
import SplashScreen from "./components/layout/SplashScreen";
import AlarmsPanel from "./components/layout/AlarmsPanel";
import CameraContextPanel from "./components/layout/CameraContextPanel";
import LoginPage from "./pages/auth/LoginPage";
import "./styles/global.css";

function AppContent() {
  const { isAuthenticated, isLoading } = useAuth();
  const [activePage, setActivePage] = useState("live-view");
  const [showSplash, setShowSplash] = useState(true);
  const [appVisible, setAppVisible] = useState(false);
  const [alarmsOpen, setAlarmsOpen] = useState(false);
  const [selectedCamera, setSelectedCamera] = useState(null);

  const handleSplashDone = () => {
    setShowSplash(false);
    setTimeout(() => setAppVisible(true), 50);
  };

  // Show loading state while checking auth
  if (isLoading) {
    return <SplashScreen onDone={() => {}} />;
  }

  // Show login page if not authenticated
  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <>
      {showSplash && <SplashScreen onDone={handleSplashDone} />}
      <div
        className="app-root"
        style={{ opacity: appVisible ? 1 : 0, transition: "opacity 0.5s ease" }}
      >
        <Sidebar activePage={activePage} onNavigate={setActivePage} />
        <div className="app-main-area">
          <TopBar
            activePage={activePage}
            onNavigate={setActivePage}
            onAlarmsClick={() => setAlarmsOpen((p) => !p)}
            alarmsOpen={alarmsOpen}
            onCameraSelect={setSelectedCamera}
            selectedCamera={selectedCamera}
          />
          <main className="app-content">
            <PageRenderer activePage={activePage} onCameraSelect={setSelectedCamera} />
          </main>
          <AlarmsPanel open={alarmsOpen} onClose={() => setAlarmsOpen(false)} />
          {selectedCamera && (
            <CameraContextPanel
              camera={selectedCamera}
              onNavigate={setActivePage}
              onClose={() => setSelectedCamera(null)}
              activePage={activePage}
            />
          )}
        </div>
      </div>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
