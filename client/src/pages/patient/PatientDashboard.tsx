import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../../components/AppHeader";
import RecordTimeline from "../../components/RecordTimeline";
import StatusBadge from "../../components/StatusBadge";
import PdfViewerModal from "../../components/PdfViewerModal";
import NotificationBell from "../../components/NotificationBell";
import LoadingState from "../../components/LoadingState";
import ErrorState from "../../components/ErrorState";
import EmptyState from "../../components/EmptyState";
import OtpInput from "../../components/OtpInput";
import GrantCountdown from "../../components/GrantCountdown";
import { useAuth } from "../../hooks/useAuth";
import { useLiveUpdates } from "../../hooks/useLiveUpdates";
import { recordsApi, accessApi } from "../../services/api";
import { MedicalRecord, AccessRequest } from "../../types";

const API_URL = import.meta.env.VITE_API_URL || "/api";

export default function PatientDashboard() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [activeGrants, setActiveGrants] = useState<AccessRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewingRecord, setViewingRecord] = useState<MedicalRecord | null>(null);
  const [copied, setCopied] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState<string | null>(null);
  const [approveDuration, setApproveDuration] = useState("24h");
  const [approveStep, setApproveStep] = useState<"form" | "otp">("form");
  const [approveOtp, setApproveOtp] = useState("");
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const fetchSeqRef = useRef(0);
  const prevRequestsRef = useRef<AccessRequest[]>([]);

  useEffect(() => {
    if (!snackbar) return;
    const timer = setTimeout(() => setSnackbar(null), 4000);
    return () => clearTimeout(timer);
  }, [snackbar]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate("/user/login");
    }
  }, [authLoading, isAuthenticated, navigate]);

  const fetchData = useCallback(async (isSilent = false) => {
    if (!user) return;
    const seq = ++fetchSeqRef.current;
    if (!isSilent) setLoading(true);

    try {
      const [timelineResult, accessResult, activeResult] = await Promise.all([
        recordsApi.timeline((user as any).id),
        accessApi.patient(),
        accessApi.active(),
      ]);

      if (seq !== fetchSeqRef.current) return; // Stale response ignored

      const newRequests: AccessRequest[] = accessResult.requests || [];
      const newActive: AccessRequest[] = activeResult.requests || [];
      const newRecords: MedicalRecord[] = timelineResult.records || [];

      // Check for newly arrived pending request to show toast
      if (isSilent && prevRequestsRef.current.length > 0) {
        const newlyArrived = newRequests.find(
          (nr) =>
            nr.status === "PENDING" &&
            !prevRequestsRef.current.some((pr) => pr.id === nr.id && pr.status === "PENDING")
        );
        if (newlyArrived) {
          const docName = newlyArrived.doctor?.name || "a doctor";
          setSnackbar(`Dr. ${docName} requested access`);
        }
      }

      prevRequestsRef.current = newRequests;
      setRecords(newRecords);
      setAccessRequests(newRequests);
      setActiveGrants(newActive);
      setError(null);
    } catch (err: any) {
      if (!isSilent) setError(err.message);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [user]);

  // Hook into live updates: refetches silently when version or pendingRequestsCount changes
  const { refetchNow } = useLiveUpdates((newStatus, prevStatus) => {
    if (
      !prevStatus ||
      newStatus.accessVersion !== prevStatus.accessVersion ||
      newStatus.pendingRequestsCount !== prevStatus.pendingRequestsCount
    ) {
      fetchData(true);
    }
  });

  useEffect(() => {
    if (isAuthenticated && user) fetchData();
  }, [isAuthenticated, user, fetchData]);

  const copyMedOrgId = () => {
    navigator.clipboard.writeText((user as any).medOrgId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const approveRequest = async (requestId: string) => {
    try {
      await accessApi.approveStart(requestId, approveDuration);
      setApproveStep("otp");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const confirmApprove = async (requestId: string) => {
    try {
      await accessApi.approve(requestId, approveOtp);
      setShowApproveDialog(null);
      setApproveStep("form");
      setApproveOtp("");
      setSnackbar("Access approved");
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const denyRequest = async (requestId: string) => {
    try {
      await accessApi.deny(requestId);
      setSnackbar("Access request denied");
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const revokeGrant = async (requestId: string) => {
    try {
      await accessApi.revoke(requestId);
      setSnackbar("Access revoked");
      fetchData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (authLoading || loading) return <LoadingState message="Loading dashboard..." />;
  if (error) return <ErrorState message={error} onRetry={fetchData} />;
  if (!user) return null;

  const pendingRequests = accessRequests.filter(r => r.status === "PENDING");

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppHeader showNav={false} />
      <div style={{ flex: 1, padding: "24px", maxWidth: 1200, margin: "0 auto", width: "100%" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h1 style={{ fontSize: 28, fontWeight: 400 }}>Welcome, {(user as any).name}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={() => { fetchData(false); refetchNow(); }}
              className="btn btn-outlined"
              style={{ minHeight: 36, padding: "0 12px", fontSize: 13 }}
              title="Refresh data"
            >
              ↻ Refresh
            </button>
            <NotificationBell />
          </div>
        </div>

        {/* MedOrg ID Card */}
        <div className="medorg-id-card" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 8 }}>MedOrg ID</div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span className="medorg-id">{(user as any).medOrgId}</span>
            <button onClick={copyMedOrgId} className="btn btn-text" style={{ color: "inherit" }}>
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>
            National ID: XXXX-XXXX-{(user as any).nationalIdLast4 || "****"}
          </div>
        </div>

        {/* Access Requests */}
        {pendingRequests.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 16 }}>Pending Access Requests</h2>
            {pendingRequests.map(req => (
              <div key={req.id} style={{ padding: 16, border: "1px solid var(--color-outline)", borderRadius: 12, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ fontWeight: 500 }}>Dr. {req.doctor?.name}</p>
                    <p className="text-secondary" style={{ fontSize: 14 }}>{req.doctor?.doctorId}</p>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => { setShowApproveDialog(req.id); setApproveStep("form"); }} className="btn btn-filled">
                      Approve
                    </button>
                    <button onClick={() => denyRequest(req.id)} className="btn btn-outlined" style={{ color: "var(--color-red)" }}>
                      Deny
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Active Grants */}
        {activeGrants.length > 0 && (
          <div className="card" style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 16 }}>Active Grants</h2>
            {activeGrants.map(grant => (
              <div key={grant.id} style={{ padding: 16, border: "1px solid var(--color-outline)", borderRadius: 12, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ fontWeight: 500 }}>Dr. {grant.doctor?.name}</p>
                    <div className="text-secondary" style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <span>Expires {grant.expiresAt ? new Date(grant.expiresAt).toLocaleDateString() : "N/A"}</span>
                      <GrantCountdown expiresAt={grant.expiresAt || null} onExpire={refetchNow} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <StatusBadge status={grant.status} />
                    <button onClick={() => revokeGrant(grant.id)} className="btn btn-outlined" style={{ color: "var(--color-red)" }}>
                      Revoke
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Medical Records */}
        <div className="card" style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 16 }}>Medical Records</h2>
          {records.length === 0 ? (
            <EmptyState title="No records yet" message="Your medical records will appear here once uploaded by your doctor." />
          ) : (
            <RecordTimeline
              records={records}
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

        {/* Profile */}
        <div className="card">
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 16 }}>Profile</h2>
          <div style={{ display: "grid", gap: 12 }}>
            <div><span className="text-secondary">Name: </span>{(user as any).name}</div>
            <div><span className="text-secondary">Email: </span>{(user as any).email}</div>
            <div><span className="text-secondary">Date of birth: </span>{(user as any).dateOfBirth || "Not provided"}</div>
          </div>
        </div>
      </div>

      {/* Approve Dialog */}
      {showApproveDialog && (
        <div className="dialog-overlay" onClick={() => setShowApproveDialog(null)}>
          <div className="dialog" onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 20, fontWeight: 500, marginBottom: 24 }}>Approve Access</h3>
            {approveStep === "form" ? (
              <div>
                <p className="text-secondary" style={{ marginBottom: 16 }}>Select access duration:</p>
                <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
                  {["24h", "3d", "7d"].map(d => (
                    <button
                      key={d}
                      onClick={() => setApproveDuration(d)}
                      className={`btn ${approveDuration === d ? "btn-filled" : "btn-outlined"}`}
                      style={{ flex: 1 }}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <button onClick={() => approveRequest(showApproveDialog)} className="btn btn-filled" style={{ width: "100%" }}>
                  Continue
                </button>
              </div>
            ) : (
              <div>
                <p className="text-secondary" style={{ marginBottom: 16 }}>Enter the OTP sent to your email:</p>
                <OtpInput value={approveOtp} onChange={setApproveOtp} />
                <button onClick={() => confirmApprove(showApproveDialog)} className="btn btn-filled" style={{ width: "100%", marginTop: 24 }} disabled={approveOtp.length !== 6}>
                  Confirm Approval
                </button>
              </div>
            )}
          </div>
        </div>
      )}

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