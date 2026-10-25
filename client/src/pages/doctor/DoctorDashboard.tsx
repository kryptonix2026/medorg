import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../../components/AppHeader";
import RecordTimeline from "../../components/RecordTimeline";
import StatusBadge from "../../components/StatusBadge";
import PdfViewerModal from "../../components/PdfViewerModal";
import AiSummaryPanel from "../../components/AiSummaryPanel";
import LoadingState from "../../components/LoadingState";
import ErrorState from "../../components/ErrorState";
import EmptyState from "../../components/EmptyState";
import GrantCountdown from "../../components/GrantCountdown";
import Icon from "../../components/Icon";
import { useAuth } from "../../hooks/useAuth";
import { useLiveUpdates } from "../../hooks/useLiveUpdates";
import { recordsApi, accessApi } from "../../services/api";
import { MedicalRecord, AccessRequest, User } from "../../types";

const API_URL = import.meta.env.VITE_API_URL || "/api";

function formatRequestDate(dateStr: string | Date | undefined): string {
  if (!dateStr) return "recently";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "recently";
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DoctorDashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeGrants, setActiveGrants] = useState<AccessRequest[]>([]);
  const [myRequests, setMyRequests] = useState<AccessRequest[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<User | null>(() => {
    try {
      const saved = sessionStorage.getItem("medorg_doctor_selected_patient");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [patientRecords, setPatientRecords] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lookupId, setLookupId] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [viewingRecord, setViewingRecord] = useState<MedicalRecord | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [requestingAccess, setRequestingAccess] = useState(false);
  const [optimisticPendingMap, setOptimisticPendingMap] = useState<Record<string, AccessRequest>>({});

  // Upload form
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploadType, setUploadType] = useState<"REPORT" | "PRESCRIPTION">("REPORT");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fetchSeqRef = useRef(0);
  const prevRequestsRef = useRef<AccessRequest[]>([]);
  const prevActiveRef = useRef<AccessRequest[]>([]);
  const myRequestsRef = useRef<AccessRequest[]>([]);

  useEffect(() => {
    myRequestsRef.current = myRequests;
  }, [myRequests]);

  // Snackbar auto-dismiss
  useEffect(() => {
    if (!snackbar) return;
    const timer = setTimeout(() => setSnackbar(null), 4000);
    return () => clearTimeout(timer);
  }, [snackbar]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/doctor/login");
    }
  }, [authLoading, isAuthenticated, navigate]);

  const getLatestRequestForPatient = useCallback((patient: User | null): AccessRequest | undefined => {
    if (!patient) return undefined;
    const opt = optimisticPendingMap[patient.id] || optimisticPendingMap[patient.medOrgId];
    if (opt) return opt;
    return myRequests.find(
      (r) =>
        r.patientId === patient.id ||
        r.patient?.id === patient.id ||
        r.patient?.medOrgId === patient.medOrgId
    );
  }, [myRequests, optimisticPendingMap]);

  const openPatient = useCallback(async (patient: User) => {
    setSelectedPatient(patient);
    try {
      sessionStorage.setItem("medorg_doctor_selected_patient", JSON.stringify(patient));
    } catch {}
    setLookupError(null);

    const latest = myRequestsRef.current.find(
      (r) =>
        r.patientId === patient.id ||
        r.patient?.id === patient.id ||
        r.patient?.medOrgId === patient.medOrgId
    );

    if (
      latest &&
      latest.status === "APPROVED" &&
      (!latest.expiresAt || new Date(latest.expiresAt) > new Date())
    ) {
      try {
        const timeline: any = await recordsApi.timeline(patient.id);
        setPatientRecords(timeline.records || []);
      } catch {
        setPatientRecords([]);
      }
    } else {
      setPatientRecords([]);
      setViewingRecord(null);
      setShowUpload(false);
    }
  }, []);

  const closePatient = useCallback(() => {
    setSelectedPatient(null);
    try {
      sessionStorage.removeItem("medorg_doctor_selected_patient");
    } catch {}
    setPatientRecords([]);
    setViewingRecord(null);
    setShowUpload(false);
  }, []);

  const fetchData = useCallback(async (isSilent = false) => {
    const seq = ++fetchSeqRef.current;
    if (!isSilent) setLoading(true);

    try {
      const [activeResult, requestsResult] = await Promise.all([
        accessApi.active(),
        accessApi.doctorMine(),
      ]);

      if (seq !== fetchSeqRef.current) return; // Stale response ignored

      const newActive: AccessRequest[] = activeResult.requests || [];
      const newRequests: AccessRequest[] = requestsResult.requests || [];

      // Detect status changes for notifications
      if (isSilent && prevRequestsRef.current.length > 0) {
        for (const req of newRequests) {
          const old = prevRequestsRef.current.find((p) => p.id === req.id);
          if (old && old.status !== req.status) {
            if (req.status === "APPROVED") {
              setSnackbar(`Access approved by ${req.patient?.name || "patient"}`);
            } else if (req.status === "DENIED") {
              setSnackbar("Access denied");
            } else if (req.status === "REVOKED" || req.status === "EXPIRED") {
              setSnackbar("Access revoked or expired");
            }
          }
        }

        // Also check if an active grant from prevActiveRef is no longer active
        for (const oldGrant of prevActiveRef.current) {
          const stillActive = newActive.some((a) => a.id === oldGrant.id);
          if (!stillActive) {
            const inReq = newRequests.find((r) => r.id === oldGrant.id);
            if (!inReq || (inReq.status !== "REVOKED" && inReq.status !== "EXPIRED")) {
              setSnackbar("Access revoked or expired");
            }
          }
        }
      }

      prevRequestsRef.current = newRequests;
      prevActiveRef.current = newActive;
      setActiveGrants(newActive);
      setMyRequests(newRequests);

      // Clean up optimistic pending entries once server data includes them
      setOptimisticPendingMap((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [key, opt] of Object.entries(next)) {
          const match = newRequests.find(
            (r) =>
              (r.patientId === opt.patientId || r.patient?.medOrgId === opt.patient?.medOrgId) &&
              (r.status === "PENDING" || r.status === "APPROVED" || r.status === "DENIED")
          );
          if (match) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      // If viewing a selected patient, sync records if approved, or close forms if revoked/expired
      setSelectedPatient((currentPatient) => {
        if (currentPatient) {
          const patientLatest = newRequests.find(
            (r) =>
              r.patientId === currentPatient.id ||
              r.patient?.id === currentPatient.id ||
              r.patient?.medOrgId === currentPatient.medOrgId
          );
          const isNowApproved =
            patientLatest &&
            patientLatest.status === "APPROVED" &&
            (!patientLatest.expiresAt || new Date(patientLatest.expiresAt) > new Date());

          if (isNowApproved) {
            recordsApi.timeline(currentPatient.id).then((timeline: any) => {
              setPatientRecords(timeline.records || []);
            }).catch(() => {});
          } else {
            setViewingRecord(null);
            setShowUpload(false);
          }
        }
        return currentPatient;
      });

      setError(null);
    } catch (err: any) {
      if (!isSilent) setError(err.message);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, []);

  // Live updates hook: refetches silently when accessVersion changes
  const { refetchNow } = useLiveUpdates((newStatus, prevStatus) => {
    if (!prevStatus || newStatus.accessVersion !== prevStatus.accessVersion) {
      fetchData(true);
    }
  });

  useEffect(() => {
    if (isAuthenticated) fetchData();
  }, [isAuthenticated, fetchData]);

  const lookupPatient = async () => {
    setLookupLoading(true);
    setLookupError(null);
    try {
      const result: any = await recordsApi.lookup(lookupId);
      openPatient(result.user);
    } catch (err: any) {
      setLookupError(err.message);
    } finally {
      setLookupLoading(false);
    }
  };

  const requestAccess = async (medOrgId: string) => {
    if (!selectedPatient) return;
    setRequestingAccess(true);

    // Optimistically switch dialog to "Request pending"
    const optimisticReq: AccessRequest = {
      id: "optimistic-" + Date.now(),
      patientId: selectedPatient.id,
      doctorId: (user as any)?.id || "",
      status: "PENDING",
      requestedAt: new Date().toISOString(),
      approvedAt: null,
      expiresAt: null,
      accessDuration: "7d",
      patient: selectedPatient,
    };

    setOptimisticPendingMap((prev) => ({
      ...prev,
      [selectedPatient.id]: optimisticReq,
      [selectedPatient.medOrgId]: optimisticReq,
    }));

    try {
      const res: any = await accessApi.request(medOrgId);
      if (res && res.alreadyPending) {
        setSnackbar("Request already pending");
      } else {
        setSnackbar("Access request sent to patient");
      }
      await fetchData(true);
      refetchNow();
    } catch (err: any) {
      setOptimisticPendingMap((prev) => {
        const next = { ...prev };
        delete next[selectedPatient.id];
        delete next[selectedPatient.medOrgId];
        return next;
      });
      setSnackbar(err.message || "Failed to send access request");
    } finally {
      setRequestingAccess(false);
    }
  };

  const handleFileSelect = (file: File | null) => {
    if (!file) return;
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Only PDF files are allowed");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File too large (max 10MB)");
      return;
    }
    setUploadFile(file);
    setUploadError(null);
  };

  const uploadRecord = async () => {
    if (!uploadFile || !selectedPatient) return;
    setUploadError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("record", uploadFile);
      formData.append("patientId", selectedPatient.id);
      formData.append("doctorId", (user as any).id);
      formData.append("recordType", uploadType);
      formData.append("title", uploadTitle);
      formData.append("description", uploadDesc);
      await recordsApi.upload(formData);
      setShowUpload(false);
      setUploadTitle("");
      setUploadDesc("");
      setUploadFile(null);
      setSnackbar("Record uploaded successfully");
      const timeline: any = await recordsApi.timeline(selectedPatient.id);
      setPatientRecords(timeline.records || []);
    } catch (err: any) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  if (authLoading || loading) return <LoadingState message="Loading dashboard..." />;
  if (error) return <ErrorState message={error} onRetry={fetchData} />;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppHeader showNav={false} />
      <div style={{ flex: 1, padding: "24px", maxWidth: 1200, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 400 }}>
            Welcome, {(user as any).name}
          </h1>
          <button
            onClick={() => { fetchData(false); refetchNow(); }}
            className="btn btn-outlined"
            style={{ minHeight: 36, padding: "0 12px", fontSize: 13 }}
            title="Refresh data"
          >
            ↻ Refresh
          </button>
        </div>

        {/* Find Patient */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 16 }}>Find Patient</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <div className="text-field" style={{ flex: 1, marginBottom: 0 }}>
              <input
                type="text"
                placeholder=" "
                value={lookupId}
                onChange={e => setLookupId(e.target.value)}
                style={{ fontFamily: "var(--font-mono)" }}
              />
              <label>MedOrg ID (e.g. MED-000001)</label>
            </div>
            <button onClick={lookupPatient} className="btn btn-filled" disabled={lookupLoading || !lookupId}>
              {lookupLoading ? "Searching..." : "Search"}
            </button>
          </div>
          {lookupError && (
            <p style={{ color: "var(--color-error-text)", fontSize: 14, marginTop: 8 }}>{lookupError}</p>
          )}
        </div>

        {/* Patient Detail */}
        {selectedPatient && (() => {
          const latestReq = getLatestRequestForPatient(selectedPatient);
          const isApproved =
            latestReq &&
            latestReq.status === "APPROVED" &&
            (!latestReq.expiresAt || new Date(latestReq.expiresAt) > new Date());

          // 1. Approved and unexpired: show records view as normal
          if (isApproved) {
            return (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginBottom: 24 }}>
                <div>
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <h2 style={{ fontSize: 18, fontWeight: 500 }}>Patient: {selectedPatient.name}</h2>
                        <StatusBadge status="APPROVED" />
                      </div>
                      <button onClick={closePatient} className="btn btn-outlined" style={{ minHeight: 32, padding: "0 10px", fontSize: 12 }}>
                        Close
                      </button>
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                      <div><span className="text-secondary">MedOrg ID: </span><span style={{ fontFamily: "var(--font-mono)" }}>{selectedPatient.medOrgId}</span></div>
                      <div><span className="text-secondary">Email: </span>{selectedPatient.email}</div>
                    </div>
                  </div>

                  {/* Upload */}
                  <div className="card" style={{ marginBottom: 16 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: 16 }}>Upload Record</h3>
                    {!showUpload ? (
                      <button onClick={() => setShowUpload(true)} className="btn btn-outlined" style={{ width: "100%" }}>
                        Upload PDF
                      </button>
                    ) : (
                      <div>
                        <div className="text-field">
                          <input type="text" placeholder=" " value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} />
                          <label>Title</label>
                        </div>
                        <div className="text-field">
                          <input type="text" placeholder=" " value={uploadDesc} onChange={e => setUploadDesc(e.target.value)} />
                          <label>Description</label>
                        </div>
                        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
                          <button
                            onClick={() => setUploadType("REPORT")}
                            className={`btn ${uploadType === "REPORT" ? "btn-filled" : "btn-outlined"}`}
                            style={{ flex: 1 }}
                          >
                            Report
                          </button>
                          <button
                            onClick={() => setUploadType("PRESCRIPTION")}
                            className={`btn ${uploadType === "PRESCRIPTION" ? "btn-filled" : "btn-outlined"}`}
                            style={{ flex: 1 }}
                          >
                            Prescription
                          </button>
                        </div>

                        {/* Drop zone + Add file button */}
                        <div
                          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                          onDragLeave={() => setDragOver(false)}
                          onDrop={e => {
                            e.preventDefault();
                            setDragOver(false);
                            handleFileSelect(e.dataTransfer.files[0]);
                          }}
                          onClick={() => fileInputRef.current?.click()}
                          style={{
                            border: `2px dashed ${dragOver ? "var(--color-blue)" : "var(--color-outline)"}`,
                            borderRadius: 12,
                            padding: "32px 16px",
                            textAlign: "center",
                            cursor: "pointer",
                            marginBottom: 16,
                            background: dragOver ? "var(--color-info-bg)" : "transparent",
                            transition: "all 0.2s ease",
                          }}
                        >
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".pdf,application/pdf"
                            style={{ display: "none" }}
                            onChange={e => handleFileSelect(e.target.files?.[0] || null)}
                          />
                          {uploadFile ? (
                            <div>
                              <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>📄 {uploadFile.name}</p>
                              <p className="text-secondary" style={{ fontSize: 12 }}>
                                {(uploadFile.size / 1024).toFixed(1)} KB
                              </p>
                              <button
                                onClick={e => { e.stopPropagation(); setUploadFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                                className="btn btn-text"
                                style={{ marginTop: 8, fontSize: 12 }}
                              >
                                Remove
                              </button>
                            </div>
                          ) : (
                            <div>
                              <p style={{ fontSize: 24, marginBottom: 8 }}>📄</p>
                              <p style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Drag & drop a PDF here</p>
                              <p className="text-secondary" style={{ fontSize: 12 }}>or click to browse</p>
                            </div>
                          )}
                        </div>

                        {uploadError && (
                          <p style={{ color: "var(--color-error-text)", fontSize: 14, marginBottom: 8 }}>{uploadError}</p>
                        )}
                        <div style={{ display: "flex", gap: 8 }}>
                          <button onClick={uploadRecord} className="btn btn-filled" style={{ flex: 1 }} disabled={uploading || !uploadFile}>
                            {uploading ? "Uploading..." : "Upload"}
                          </button>
                          <button onClick={() => { setShowUpload(false); setUploadFile(null); setUploadError(null); }} className="btn btn-outlined" style={{ flex: 1 }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* AI Summary */}
                  <AiSummaryPanel patientId={selectedPatient.id} />
                </div>

                {/* Records */}
                <div className="card">
                  <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 16 }}>Records</h2>
                  {patientRecords.length === 0 ? (
                    <EmptyState title="No records" message="No medical records found for this patient." />
                  ) : (
                    <RecordTimeline
                      records={patientRecords}
                      onView={setViewingRecord}
                      onDownload={async (record) => {
                        const token = localStorage.getItem("medorg_token");
                        const response = await fetch(`${API_URL}/records/${record.id}/download`, {
                          headers: { Authorization: `Bearer ${token}` },
                        });
                        const blob = await response.blob();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = record.originalFileName;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    />
                  )}
                </div>
              </div>
            );
          }

          // 2. Latest is PENDING: show "Request pending" state
          if (latestReq && latestReq.status === "PENDING") {
            return (
              <div className="card" style={{ padding: "32px 24px", textAlign: "center", border: "1px solid var(--color-outline)", borderRadius: 12, marginBottom: 24 }}>
                <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>
                  <Icon name="schedule" size={40} color="var(--color-warning-text)" />
                </div>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                  <StatusBadge status="PENDING" />
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>Request pending</h2>
                <p className="text-secondary" style={{ fontSize: 14, maxWidth: 500, margin: "0 auto 20px", lineHeight: 1.6 }}>
                  Your request for access to <strong>{selectedPatient.name}</strong> ({selectedPatient.medOrgId}) was sent on {formatRequestDate(latestReq.requestedAt)}. You will be able to view records as soon as the patient approves it.
                </p>
                <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                  <button onClick={closePatient} className="btn btn-outlined">
                    Close
                  </button>
                </div>
              </div>
            );
          }

          // 3. Latest is DENIED: show "Request denied" state
          if (latestReq && latestReq.status === "DENIED") {
            return (
              <div className="card" style={{ padding: "32px 24px", textAlign: "center", border: "1px solid var(--color-outline)", borderRadius: 12, marginBottom: 24 }}>
                <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>
                  <Icon name="cancel" size={40} color="var(--color-error-text)" />
                </div>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
                  <StatusBadge status="DENIED" />
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>Request denied</h2>
                <p className="text-secondary" style={{ fontSize: 14, maxWidth: 500, margin: "0 auto 20px", lineHeight: 1.6 }}>
                  The patient declined this request.
                </p>
                <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={() => requestAccess(selectedPatient.medOrgId)}
                    disabled={requestingAccess}
                    className="btn btn-filled"
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                  >
                    {requestingAccess && (
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          border: "2px solid rgba(255,255,255,0.4)",
                          borderTopColor: "#fff",
                          borderRadius: "50%",
                          animation: "spin 0.8s linear infinite",
                          display: "inline-block",
                        }}
                      />
                    )}
                    {requestingAccess ? "Requesting..." : "Request access again"}
                  </button>
                  <button onClick={closePatient} className="btn btn-outlined">
                    Close
                  </button>
                </div>
              </div>
            );
          }

          // 4. Latest is REVOKED or EXPIRED: show "Access ended" state
          if (
            latestReq &&
            (latestReq.status === "REVOKED" ||
              latestReq.status === "EXPIRED" ||
              (latestReq.status === "APPROVED" && latestReq.expiresAt && new Date(latestReq.expiresAt) <= new Date()))
          ) {
            return (
              <div className="card" style={{ padding: "32px 24px", textAlign: "center", border: "1px solid var(--color-outline)", borderRadius: 12, marginBottom: 24 }}>
                <div style={{ marginBottom: 12, display: "flex", justifyContent: "center" }}>
                  <Icon name="lock" size={40} color="var(--color-secondary-text)" />
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>Access ended</h2>
                <p className="text-secondary" style={{ fontSize: 14, maxWidth: 500, margin: "0 auto 20px", lineHeight: 1.6 }}>
                  Access authorization for <strong>{selectedPatient.name}</strong> ({selectedPatient.medOrgId}) has been revoked or expired. Request access again to continue viewing records.
                </p>
                <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    onClick={() => requestAccess(selectedPatient.medOrgId)}
                    disabled={requestingAccess}
                    className="btn btn-filled"
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                  >
                    {requestingAccess && (
                      <span
                        style={{
                          width: 14,
                          height: 14,
                          border: "2px solid rgba(255,255,255,0.4)",
                          borderTopColor: "#fff",
                          borderRadius: "50%",
                          animation: "spin 0.8s linear infinite",
                          display: "inline-block",
                        }}
                      />
                    )}
                    {requestingAccess ? "Requesting..." : "Request access again"}
                  </button>
                  <button onClick={closePatient} className="btn btn-outlined">
                    Close
                  </button>
                </div>
              </div>
            );
          }

          // 5. No requests yet between this doctor and patient:
          return (
            <div className="card" style={{ padding: "24px", border: "1px solid var(--color-outline)", borderRadius: 12, marginBottom: 24 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                <h2 style={{ fontSize: 18, fontWeight: 500 }}>Patient: {selectedPatient.name}</h2>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => requestAccess(selectedPatient.medOrgId)}
                    disabled={requestingAccess}
                    className="btn btn-filled"
                  >
                    {requestingAccess ? "Requesting..." : "Request Access"}
                  </button>
                  <button onClick={closePatient} className="btn btn-outlined">
                    Close
                  </button>
                </div>
              </div>
              <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
                <div><span className="text-secondary">MedOrg ID: </span><span style={{ fontFamily: "var(--font-mono)" }}>{selectedPatient.medOrgId}</span></div>
                <div><span className="text-secondary">Email: </span>{selectedPatient.email}</div>
              </div>
              <p className="text-secondary" style={{ fontSize: 14 }}>
                No active access authorization for this patient. Click "Request Access" to request permission to view medical records.
              </p>
            </div>
          );
        })()}

        {/* Active Grants */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 16 }}>Active Patient Grants</h2>
          {activeGrants.length === 0 ? (
            <EmptyState title="No active grants" message="Request access to a patient's records to get started." />
          ) : (
            activeGrants.map(grant => (
              <div key={grant.id} style={{ padding: 16, border: "1px solid var(--color-outline)", borderRadius: 12, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ fontWeight: 500 }}>{grant.patient?.name}</p>
                  <p className="text-secondary" style={{ fontSize: 14, fontFamily: "var(--font-mono)" }}>{grant.patient?.medOrgId}</p>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <StatusBadge status={grant.status} />
                  <GrantCountdown expiresAt={grant.expiresAt || null} onExpire={refetchNow} />
                  <button onClick={() => { if (grant.patient) openPatient(grant.patient); }} className="btn btn-text">
                    View
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* My Requests */}
        <div className="card">
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 16 }}>My Access Requests</h2>
          {myRequests.length === 0 ? (
            <EmptyState title="No requests" message="You haven't requested access to any patients yet." />
          ) : (
            myRequests.map(req => (
              <div key={req.id} style={{ padding: 16, border: "1px solid var(--color-outline)", borderRadius: 12, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <p style={{ fontWeight: 500 }}>{req.patient?.name}</p>
                  <p className="text-secondary" style={{ fontSize: 14 }}>{new Date(req.requestedAt).toLocaleDateString()}</p>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <StatusBadge status={req.status} />
                  {req.patient && (
                    <button
                      onClick={() => openPatient(req.patient!)}
                      className={req.status === "APPROVED" ? "btn btn-filled" : "btn btn-outlined"}
                      style={{ minHeight: 32, padding: "0 12px", fontSize: 13 }}
                      title={req.status === "PENDING" ? "View request status" : undefined}
                    >
                      {req.status === "APPROVED" ? "Open patient" : req.status === "PENDING" ? "View status" : "View"}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* PDF Viewer */}
      {viewingRecord && (
        <PdfViewerModal
          recordId={viewingRecord.id}
          title={viewingRecord.title}
          onClose={() => setViewingRecord(null)}
        />
      )}

      {/* Snackbar */}
      {snackbar && (
        <div className="snackbar">
          <span>{snackbar}</span>
          <button
            onClick={() => setSnackbar(null)}
            style={{ background: "none", border: "none", color: "var(--color-blue)", cursor: "pointer", fontSize: 14, fontWeight: 500 }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}