import StatusBadge from "./StatusBadge";
import { MedicalRecord } from "../types";

interface RecordTimelineProps {
  records: MedicalRecord[];
  onView?: (record: MedicalRecord) => void;
  onDownload?: (record: MedicalRecord) => void;
}

export default function RecordTimeline({ records, onView, onDownload }: RecordTimelineProps) {
  if (records.length === 0) {
    return (
      <div className="text-secondary" style={{ padding: 32, textAlign: "center" }}>
        No records yet
      </div>
    );
  }

  return (
    <div className="timeline">
      {records.map(record => (
        <div key={record.id} className="timeline-item">
          <div
            className="timeline-dot"
            style={{ background: record.recordType === "REPORT" ? "var(--color-blue)" : "var(--color-green)" }}
          />
          <div className="timeline-date">
            {new Date(record.uploadedAt).toLocaleDateString()}
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <StatusBadge status={record.recordType} type="record" />
                  <h4 style={{ fontSize: 16, fontWeight: 500 }}>{record.title}</h4>
                </div>
                {record.description && (
                  <p className="text-secondary" style={{ fontSize: 14, marginBottom: 8 }}>
                    {record.description}
                  </p>
                )}
                <p className="text-secondary" style={{ fontSize: 12 }}>
                  Dr. {record.doctor?.name} • {record.originalFileName}
                </p>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {onView && (
                  <button className="btn btn-text" onClick={() => onView(record)}>
                    View
                  </button>
                )}
                {onDownload && (
                  <button className="btn btn-text" onClick={() => onDownload(record)}>
                    Download
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}