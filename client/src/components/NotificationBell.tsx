import { useState, useEffect } from "react";
import { notificationsApi } from "../services/api";
import { Notification } from "../types";
import { useLiveUpdates } from "../hooks/useLiveUpdates";

export default function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);

  const fetchNotifications = async () => {
    try {
      const [notifResult, countResult] = await Promise.all([
        notificationsApi.get(),
        notificationsApi.count(),
      ]);
      setNotifications(notifResult.notifications || []);
      setUnreadCount(countResult.count || 0);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  useLiveUpdates((newStatus, prevStatus) => {
    if (!prevStatus || newStatus.unreadNotifications !== prevStatus.unreadNotifications) {
      setUnreadCount(newStatus.unreadNotifications);
      fetchNotifications();
    }
  });

  const markRead = async (id: string) => {
    await notificationsApi.markRead(id);
    fetchNotifications();
  };

  const markAllRead = async () => {
    await notificationsApi.markAllRead();
    fetchNotifications();
  };

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        className="btn btn-text"
        style={{ position: "relative", minWidth: 40, padding: 8 }}
        aria-label={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
      >
        🔔
        {unreadCount > 0 && (
          <span style={{
            position: "absolute", top: 4, right: 4,
            width: 16, height: 16, borderRadius: "50%",
            background: "var(--color-red)", color: "white",
            fontSize: 10, fontWeight: 700,
            display: "flex", alignItems: "center", justifyContent: "center"
          }}>
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "100%", right: 0,
          width: 360, maxHeight: 400, overflowY: "auto",
          background: "var(--color-background)",
          border: "1px solid var(--color-outline)",
          borderRadius: 8, boxShadow: "var(--elevation-3)",
          zIndex: 100
        }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-outline)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h4 style={{ fontSize: 14, fontWeight: 500 }}>Notifications</h4>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="btn btn-text" style={{ fontSize: 12 }}>
                Mark all read
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--color-secondary-text)" }}>
              No notifications
            </div>
          ) : (
            notifications.map(n => (
              <div
                key={n.id}
                onClick={() => !n.read && markRead(n.id)}
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--color-outline)",
                  cursor: n.read ? "default" : "pointer",
                  background: n.read ? "transparent" : "var(--color-info-bg)",
                }}
              >
                <div style={{ fontSize: 14, fontWeight: n.read ? 400 : 500 }}>{n.title}</div>
                <div style={{ fontSize: 13, color: "var(--color-secondary-text)", marginTop: 4 }}>{n.message}</div>
                <div style={{ fontSize: 11, color: "var(--color-secondary-text)", marginTop: 4 }}>
                  {new Date(n.createdAt).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}