import { useState, useEffect } from "react";
import AppHeader from "../components/AppHeader";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import { databaseApi } from "../services/api";
import { DatabaseSummary } from "../types";

type Tab = "patients" | "doctors" | "records" | "accessRequests" | "sessions";

export default function DatabaseViewer() {
  const [data, setData] = useState<DatabaseSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("patients");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetting, setResetting] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const result = await databaseApi.summary();
      setData(result as DatabaseSummary);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const handleReset = async () => {
    setResetting(true);
    try {
      await databaseApi.reset();
      setShowResetDialog(false);
      fetchData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setResetting(false);
    }
  };

  if (loading && !data) return <LoadingState message="Loading database..." />;
  if (error) return <ErrorState message={error} onRetry={fetchData} />;
  if (data?.disabled) {
    return (
      <div style={{ minHeight: "100vh" }}>
        <AppHeader showNav={false} />
        <div style={{ padding: 48, textAlign: "center" }}>
          <h2 style={{ fontSize: 24, fontWeight: 400, marginBottom: 16 }}>Viewer disabled on this deployment</h2>
          <p className="text-secondary">Database viewer is not available in this environment.</p>
        </div>
      </div>
    );
  }

  const tabs: Tab[] = ["patients", "doctors", "records", "accessRequests", "sessions"];

  return (
    <div style={{ minHeight: "100vh" }}>
      <AppHeader showNav={false} />
      <div style={{ padding: "24px", maxWidth: 1400, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 400 }}>Database Viewer</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
              Auto-refresh (5s)
            </label>
            <button onClick={fetchData} className="btn btn-outlined">Refresh</button>
            <button onClick={() => setShowResetDialog(true)} className="btn btn-outlined" style={{ color: "var(--color-red)" }}>
              Reset
            </button>
          </div>
        </div>

        {/* Counts */}
        {data?.counts && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 16, marginBottom: 24 }}>
            {Object.entries(data.counts).map(([key, value]) => (
              <div key={key} className="card" style={{ padding: 16, textAlign: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 500, color: "var(--color-blue)" }}>{value}</div>
                <div className="text-secondary" style={{ fontSize: 12, textTransform: "capitalize" }}>{key}</div>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="tabs" style={{ marginBottom: 24 }}>
          {tabs.map(tab => (
            <button
              key={tab}
              className={`tab ${activeTab === tab ? "active" : ""}`}
              onClick={() => setActiveTab(tab)}
              style={{ textTransform: "capitalize" }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto", background: "var(--color-background)", border: "1px solid var(--color-outline)", borderRadius: 8 }}>
          {data?.[activeTab] && data[activeTab].length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ position: "sticky", top: 0, background: "var(--color-surface)", borderBottom: "2px solid var(--color-outline)" }}>
                  {Object.keys(data[activeTab][0]).map(key => (
                    <th key={key} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {key}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data[activeTab].map((row: any, i: number) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--color-outline)" }}>
                    {Object.values(row).map((val: any, j: number) => (
                      <td key={j} style={{ padding: "12px 16px", fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--color-text)" }}>
                        {typeof val === "object" && val !== null ? JSON.stringify(val) : String(val)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 48, textAlign: "center", color: "var(--color-secondary-text)" }}>
              No data
            </div>
          )}
        </div>
      </div>

      {/* Reset Dialog */}
      {showResetDialog && (
        <div className="dialog-overlay" onClick={() => setShowResetDialog(false)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 20, fontWeight: 500, marginBottom: 16 }}>Reset Database</h3>
            <p className="text-secondary" style={{ marginBottom: 24 }}>
              This will wipe all data and restore the seed data. This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowResetDialog(false)} className="btn btn-text">
                Cancel
              </button>
              <button onClick={handleReset} className="btn btn-filled" style={{ background: "var(--color-red)" }} disabled={resetting}>
                {resetting ? "Resetting..." : "Reset"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}