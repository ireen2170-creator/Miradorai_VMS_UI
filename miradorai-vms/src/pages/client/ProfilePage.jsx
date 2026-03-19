import React from "react";
import { useAuth } from "../../context/AuthContext";
import "./Usersettingspage.css";

const ProfilePage = () => {
  const { user } = useAuth();

  if (!user) {
    return <div className="page-content">No user is logged in.</div>;
  }

  return (
    <div className="page-content" style={{ padding: "24px" }}>
      <h2>Profile</h2>
      <div className="profile-card">
        <div><strong>Email:</strong> {user.email}</div>
        <div><strong>Role:</strong> {user.role}</div>
        <div><strong>Login time:</strong> {user.loginDate}</div>
        <div><strong>Session ID:</strong> {user.sessionId}</div>
        {user.oauthProvider && <div><strong>Auth provider:</strong> {user.oauthProvider}</div>}
      </div>
    </div>
  );
};

export default ProfilePage;
