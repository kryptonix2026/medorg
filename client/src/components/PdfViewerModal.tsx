import { useState, useEffect } from "react";
import LoadingState from "./LoadingState";
import ErrorState from "./ErrorState";

const API_URL = import.meta.env.VITE_API_URL || "/api";

interface PdfViewerModalProps {
  recordId: string;
  title: string;
  onClose: () => void;
}

export default function PdfViewerModal({ recordId, title, onClose }: PdfViewerModalProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    const fetchPdf = async () => {
      try {
        const token = localStorage.getItem("medorg_token");
        const response = await fetch(`${API_URL}/records/${recordId}/view`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to load PDF");
        }
        const blob = await response.blob();
        url = URL.createObjectURL(blob);
        setPdfUrl(url);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchPdf();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [recordId]);

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog"
        style={{ width: "90vw", height: "90vh", maxWidth: "none", padding: 0, display: "flex", flexDirection: "column" }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--color-outline)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ fontSize: 18, fontWeight: 500 }}>{title}</h3>
          <button onClick={onClose} className="btn btn-text">Close</button>
        </div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--color-surface-variant)" }}>
          {loading && <LoadingState message="Loading PDF..." />}
          {error && <ErrorState message={error} />}
          {pdfUrl && (
            <iframe
              src={pdfUrl}
              style={{ width: "100%", height: "100%", border: "none" }}
              title={title}
            />
          )}
        </div>
      </div>
    </div>
  );
}