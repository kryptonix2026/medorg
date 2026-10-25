import { useState, useEffect } from "react";
import { aiApi } from "../services/api";
import { AiStatus } from "../types";

interface AiSummaryPanelProps {
  patientId: string;
}

export default function AiSummaryPanel({ patientId }: AiSummaryPanelProps) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [recordsUsed, setRecordsUsed] = useState<number | null>(null);
  const [recordsSkipped, setRecordsSkipped] = useState<
    Array<{ title: string; reason: string }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    aiApi.status().then(setStatus).catch(() => {});
  }, []);

  const generateSummary = async () => {
    setLoading(true);
    setError(null);
    try {
      const result: any = await aiApi.summarize(patientId);
      setSummary(result.summary);
      setRecordsUsed(typeof result.recordsUsed === "number" ? result.recordsUsed : null);
      setRecordsSkipped(Array.isArray(result.recordsSkipped) ? result.recordsSkipped : []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!status?.configured) {
    return (
      <div className="ai-panel">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <span style={{ fontSize: 20 }}>✨</span>
          <h3 style={{ fontSize: 18, fontWeight: 500 }}>AI Summary</h3>
        </div>
        <p className="text-secondary" style={{ marginBottom: 16 }}>
          AI is not configured. Please set GROQ_API_KEY in the root .env and restart.
        </p>
        <p style={{ fontSize: 12, color: "var(--color-secondary-text)" }}>
          This is an automated summary of the uploaded documents' text, not a clinical assessment by a person.
        </p>
      </div>
    );
  }

  return (
    <div className="ai-panel ai-panel-gradient">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 20 }}>✨</span>
        <h3 style={{ fontSize: 18, fontWeight: 500 }}>AI Summary</h3>
        <span style={{ fontSize: 12, color: "var(--color-secondary-text)", marginLeft: "auto" }}>
          {status.model || "Groq"}
        </span>
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            background: "var(--color-error-bg)",
            borderRadius: 8,
            marginBottom: 16,
            color: "var(--color-error-text)",
          }}
        >
          {error}
          <button onClick={generateSummary} className="btn btn-text" style={{ marginLeft: 8 }}>
            Retry
          </button>
        </div>
      )}

      {summary && (
        <>
          <div
            style={{
              padding: 16,
              background: "var(--color-surface)",
              borderRadius: 8,
              marginBottom: 12,
              whiteSpace: "pre-wrap",
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            {summary}
          </div>

          {recordsUsed !== null && (
            <div
              style={{
                fontSize: 12,
                color: "var(--color-secondary-text)",
                marginBottom: 12,
                display: "flex",
                flexWrap: "wrap",
                gap: 8,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  background: "var(--color-surface)",
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: "1px solid var(--color-outline)",
                }}
              >
                📄 {recordsUsed} document{recordsUsed === 1 ? "" : "s"} analyzed with selectable text
              </span>

              {recordsSkipped.length > 0 && (
                <span
                  style={{
                    background: "var(--color-surface)",
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid var(--color-outline)",
                    color: "var(--color-yellow)",
                  }}
                >
                  ⚠️ {recordsSkipped.length} document{recordsSkipped.length === 1 ? "" : "s"} skipped
                </span>
              )}
            </div>
          )}

          {recordsSkipped.length > 0 && (
            <div
              style={{
                fontSize: 12,
                padding: 10,
                background: "var(--color-surface)",
                borderRadius: 6,
                marginBottom: 16,
                border: "1px solid var(--color-outline)",
              }}
            >
              <div style={{ fontWeight: 500, marginBottom: 4 }}>Unreadable records:</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {recordsSkipped.map((item, idx) => (
                  <li key={idx} style={{ color: "var(--color-secondary-text)" }}>
                    <strong>{item.title}</strong>: {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <button
        onClick={generateSummary}
        disabled={loading}
        className="btn btn-filled"
        style={{ width: "100%" }}
      >
        {loading ? "Generating..." : summary ? "Regenerate Summary" : "Generate Summary"}
      </button>

      <p style={{ fontSize: 12, color: "var(--color-secondary-text)", marginTop: 16 }}>
        This is an automated summary of the uploaded documents' text, not a clinical assessment by a person.
      </p>
    </div>
  );
}