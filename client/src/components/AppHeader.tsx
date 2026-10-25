import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { useLiveStatus } from "../context/LiveUpdatesContext";

interface AppHeaderProps {
  showNav?: boolean;
}

export default function AppHeader({ showNav = true }: AppHeaderProps) {
  const { user, isAuthenticated, logout } = useAuth();
  const { isReconnecting } = useLiveStatus();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <header style={{
      height: 64,
      background: "var(--color-surface)",
      borderBottom: "1px solid var(--color-outline)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 24px",
      position: "sticky",
      top: 0,
      zIndex: 50
    }}>
      <Link to="/" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          <div style={{ width: 8, height: 8, background: "var(--color-blue)", borderRadius: 2 }} />
          <div style={{ width: 8, height: 8, background: "var(--color-red)", borderRadius: 2 }} />
          <div style={{ width: 8, height: 8, background: "var(--color-yellow)", borderRadius: 2 }} />
          <div style={{ width: 8, height: 8, background: "var(--color-green)", borderRadius: 2 }} />
        </div>
        <span style={{ fontFamily: "var(--font-sans)", fontSize: 20, fontWeight: 500, color: "var(--color-text)" }}>
          MedOrg
        </span>
      </Link>

      {showNav && (
        <nav style={{ display: "flex", gap: 4 }}>
          <Link to="/user" className="btn btn-text">Patient</Link>
          <Link to="/doctor" className="btn btn-text">Doctor</Link>
          <Link to="/database" className="btn btn-text">Database</Link>
        </nav>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={toggleTheme}
          className="btn btn-text"
          style={{ minWidth: 40, padding: 8 }}
          aria-label="Toggle theme"
        >
          {theme === "light" ? "🌙" : "☀"}
        </button>

        {isAuthenticated && (
          <>
            <div
              title={isReconnecting ? "Reconnecting…" : "Live updates active"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 10px",
                borderRadius: 16,
                fontSize: 12,
                fontWeight: 500,
                background: isReconnecting ? "rgba(128, 128, 128, 0.12)" : "rgba(52, 168, 83, 0.12)",
                color: isReconnecting ? "var(--color-text-secondary, #666)" : "var(--color-green, #34a853)",
                transition: "all 0.2s ease",
                cursor: "default",
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  backgroundColor: isReconnecting ? "#888888" : "var(--color-green, #34a853)",
                  display: "inline-block",
                  boxShadow: isReconnecting ? "none" : "0 0 6px var(--color-green, #34a853)",
                }}
              />
              <span>{isReconnecting ? "Reconnecting…" : "Live"}</span>
            </div>

            <div style={{
              width: 36, height: 36, borderRadius: "50%",
              background: "var(--color-blue)", color: "white",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 14, fontWeight: 500
            }}>
              {(user as any)?.name?.[0] || "?"}
            </div>
            <button onClick={handleLogout} className="btn btn-text">Sign out</button>
          </>
        )}
      </div>
    </header>
  );
}