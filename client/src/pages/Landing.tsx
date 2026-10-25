import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import AppHeader from "../components/AppHeader";
import { checkHealth } from "../services/api";

export default function Landing() {
  const [apiStatus, setApiStatus] = useState<"checking" | "ok" | "error">("checking");
  const [aiConfigured, setAiConfigured] = useState(false);

  useEffect(() => {
    const check = async () => {
      const healthy = await checkHealth(3);
      setApiStatus(healthy ? "ok" : "error");
      if (healthy) {
        try {
          const response = await fetch("/api/ai/status");
          const data = await response.json();
          setAiConfigured(data.configured);
        } catch {
          // ignore
        }
      }
    };
    check();
  }, []);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppHeader />

      {/* Hero */}
      <section style={{ padding: "80px 24px", textAlign: "center", background: "var(--color-surface)" }}>
        <div className="gradient-strip" style={{ width: 120, margin: "0 auto 32px", borderRadius: 4 }} />
        <h1 style={{ fontSize: "clamp(36px, 5vw, 45px)", fontWeight: 400, lineHeight: 1.1, marginBottom: 16 }}>
          Your medical records.<br />One secure place.
        </h1>
        <p className="text-secondary" style={{ fontSize: 18, maxWidth: 600, margin: "0 auto 32px" }}>
          MedOrg gives patients control of their records and doctors secure, time-limited access.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Link to="/user" className="btn btn-filled" style={{ minHeight: 48, padding: "0 32px" }}>
            Patient portal
          </Link>
          <Link to="/doctor" className="btn btn-outlined" style={{ minHeight: 48, padding: "0 32px" }}>
            Doctor portal
          </Link>
        </div>
      </section>

      {/* Status strip */}
      <div style={{ padding: "16px 24px", background: "var(--color-background)", borderBottom: "1px solid var(--color-outline)", display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: apiStatus === "ok" ? "var(--color-green)" : apiStatus === "error" ? "var(--color-red)" : "var(--color-yellow)" }} />
          <span className="text-secondary">
            {apiStatus === "checking" ? "Waking up server..." : apiStatus === "ok" ? "API connected" : "API unavailable"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: aiConfigured ? "var(--color-green)" : "var(--color-yellow)" }} />
          <span className="text-secondary">
            {aiConfigured
              ? "AI summary ready"
              : "AI not configured (set GROQ_API_KEY in root .env)"}
          </span>
        </div>
      </div>

      {/* Feature cards */}
      <section style={{ padding: "64px 24px", maxWidth: 1200, margin: "0 auto", width: "100%" }}>
        <h2 style={{ fontSize: 28, fontWeight: 400, textAlign: "center", marginBottom: 48 }}>
          Built for patients and doctors
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24 }}>
          {[
            { title: "Patient-owned", desc: "Your records belong to you. You decide who sees them and for how long.", color: "var(--color-blue)" },
            { title: "Time-limited access", desc: "Grant doctors access for 24 hours, 3 days, or 7 days. Revoke anytime.", color: "var(--color-green)" },
            { title: "AI summary", desc: "Doctors get an instant plain-language summary of on-file records.", color: "var(--color-yellow)" },
            { title: "Audit trail", desc: "Every access, upload, and view is logged. Full transparency.", color: "var(--color-red)" },
          ].map((feature, i) => (
            <div key={i} className="card">
              <div style={{ width: 40, height: 40, borderRadius: 12, background: feature.color, opacity: 0.15, marginBottom: 16 }} />
              <h3 style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>{feature.title}</h3>
              <p className="text-secondary" style={{ fontSize: 14 }}>{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ padding: "48px 24px", background: "var(--color-surface)", borderTop: "1px solid var(--color-outline)", marginTop: "auto" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 32 }}>
          <div>
            <h4 style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Product</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <Link to="/user" style={{ fontSize: 14, color: "var(--color-secondary-text)", textDecoration: "none" }}>Patient Portal</Link>
              <Link to="/doctor" style={{ fontSize: 14, color: "var(--color-secondary-text)", textDecoration: "none" }}>Doctor Portal</Link>
              <Link to="/database" style={{ fontSize: 14, color: "var(--color-secondary-text)", textDecoration: "none" }}>Database Viewer</Link>
            </div>
          </div>
          <div>
            <h4 style={{ fontSize: 14, fontWeight: 500, marginBottom: 16 }}>Security</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: 14, color: "var(--color-secondary-text)" }}>End-to-end encryption</span>
              <span style={{ fontSize: 14, color: "var(--color-secondary-text)" }}>Audit logging</span>
              <span style={{ fontSize: 14, color: "var(--color-secondary-text)" }}>Access controls</span>
            </div>
          </div>
        </div>
        <div style={{ maxWidth: 1200, margin: "32px auto 0", paddingTop: 24, borderTop: "1px solid var(--color-outline)" }}>
          <p className="text-secondary" style={{ fontSize: 12 }}>© 2026 MedOrg. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}