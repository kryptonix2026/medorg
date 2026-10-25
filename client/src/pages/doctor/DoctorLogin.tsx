import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import AppHeader from "../../components/AppHeader";
import OtpInput from "../../components/OtpInput";
import { authApi } from "../../services/api";
import { useAuth } from "../../hooks/useAuth";

export default function DoctorLogin() {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [step, setStep] = useState<"form" | "otp">("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [hospitalName, setHospitalName] = useState("");
  const [licenseStatus, setLicenseStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const purpose = mode === "register" ? "DOCTOR_REGISTRATION" : "DOCTOR_LOGIN";

  // Debounced license check
  useEffect(() => {
    if (mode !== "register" || !licenseNumber || licenseNumber.length < 5) {
      setLicenseStatus("idle");
      return;
    }
    const timer = setTimeout(async () => {
      setLicenseStatus("checking");
      try {
        const result: any = await authApi.licenseStatus(licenseNumber);
        setLicenseStatus(result.available ? "available" : "taken");
      } catch {
        setLicenseStatus("idle");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [licenseNumber, mode]);

  const sendOtp = async () => {
    setError(null);
    setLoading(true);
    try {
      if (mode === "register") {
        await authApi.doctorSendOtp(email, purpose, name, licenseNumber, hospitalName);
      } else {
        await authApi.doctorSendOtp(email, purpose);
      }
      setStep("otp");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setError(null);
    setLoading(true);
    try {
      const result: any = mode === "register"
        ? await authApi.doctorVerifyOtp(email, purpose, otp, name, licenseNumber, hospitalName)
        : await authApi.doctorVerifyOtp(email, purpose, otp);
      login(result.token, result.user);
      navigate("/doctor");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AppHeader showNav={false} />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div className="card" style={{ width: "100%", maxWidth: 440, padding: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 400, textAlign: "center", marginBottom: 24 }}>
            Doctor Portal
          </h1>

          <div className="tabs" style={{ marginBottom: 32 }}>
            <button
              className={`tab ${mode === "register" ? "active" : ""}`}
              onClick={() => { setMode("register"); setStep("form"); setError(null); }}
            >
              Register
            </button>
            <button
              className={`tab ${mode === "login" ? "active" : ""}`}
              onClick={() => { setMode("login"); setStep("form"); setError(null); }}
            >
              Sign in
            </button>
          </div>

          {error && (
            <div style={{ padding: 12, background: "var(--color-error-bg)", borderRadius: 8, marginBottom: 16, color: "var(--color-error-text)", fontSize: 14 }}>
              {error}
            </div>
          )}

          {step === "form" ? (
            <form onSubmit={e => { e.preventDefault(); sendOtp(); }}>
              {mode === "register" && (
                <>
                  <div className="text-field">
                    <input type="text" placeholder=" " value={name} onChange={e => setName(e.target.value)} required disabled={loading} />
                    <label>Full name</label>
                  </div>
                  <div className="text-field">
                    <input type="text" placeholder=" " value={licenseNumber} onChange={e => setLicenseNumber(e.target.value)} required disabled={loading} />
                    <label>Medical license number</label>
                    {licenseStatus === "taken" && (
                      <p style={{ color: "var(--color-error-text)", fontSize: 12, marginTop: 4 }}>
                        License already registered
                      </p>
                    )}
                    {licenseStatus === "available" && (
                      <p style={{ color: "var(--color-green)", fontSize: 12, marginTop: 4 }}>
                        Available
                      </p>
                    )}
                  </div>
                  <div className="text-field">
                    <input type="text" placeholder=" " value={hospitalName} onChange={e => setHospitalName(e.target.value)} required disabled={loading} />
                    <label>Hospital affiliation</label>
                  </div>
                </>
              )}
              <div className="text-field">
                <input type="email" placeholder=" " value={email} onChange={e => setEmail(e.target.value)} required disabled={loading} />
                <label>Email address</label>
              </div>
              <button
                type="submit"
                className="btn btn-filled"
                style={{ width: "100%", minHeight: 48 }}
                disabled={loading || (mode === "register" && licenseStatus === "taken")}
              >
                {loading ? "Sending..." : mode === "register" ? "Register — Send OTP" : "Sign in — Send OTP"}
              </button>
            </form>
          ) : (
            <div>
              <p className="text-secondary" style={{ textAlign: "center", marginBottom: 24, fontSize: 14 }}>
                Enter the 6-digit code sent to {email}
              </p>
              <OtpInput value={otp} onChange={setOtp} error={!!error} disabled={loading} />
              <button
                onClick={verifyOtp}
                className="btn btn-filled"
                style={{ width: "100%", minHeight: 48, marginTop: 24 }}
                disabled={loading || otp.length !== 6}
              >
                {loading ? "Verifying..." : "Verify OTP"}
              </button>
              <button
                onClick={() => { setStep("form"); setOtp(""); setError(null); }}
                className="btn btn-text"
                style={{ width: "100%", marginTop: 8 }}
              >
                Back
              </button>
            </div>
          )}

          <p style={{ textAlign: "center", marginTop: 24, fontSize: 14 }} className="text-secondary">
            Are you a patient?{" "}
            <Link to="/user/login" style={{ color: "var(--color-blue)" }}>Sign in here</Link>
          </p>
        </div>
      </div>
    </div>
  );
}