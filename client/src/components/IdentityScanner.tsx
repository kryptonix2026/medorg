import { useState, useRef } from "react";

interface IdentityScannerProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function IdentityScanner({ value, onChange, disabled }: IdentityScannerProps) {
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const startScan = async () => {
    try {
      setScanError(null);
      setScanning(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err: any) {
      setScanError("Camera access denied. Please enter ID manually.");
      setScanning(false);
    }
  };

  const stopScan = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setScanning(false);
  };

  const capture = async () => {
    // Simple OCR via Tesseract.js would go here
    // For now, just stop the camera
    stopScan();
  };

  const handleManualInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target.value.replace(/\D/g, "").slice(0, 12);
    onChange(input);
  };

  return (
    <div className="text-field">
      {scanning ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <video
            ref={videoRef}
            style={{ width: "100%", borderRadius: 8, border: "1px solid var(--color-outline)" }}
            playsInline
            muted
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={capture} className="btn btn-filled" style={{ flex: 1 }}>
              Capture
            </button>
            <button onClick={stopScan} className="btn btn-outlined" style={{ flex: 1 }}>
              Cancel
            </button>
          </div>
          {scanError && (
            <p style={{ color: "var(--color-error-text)", fontSize: 14 }}>{scanError}</p>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            inputMode="numeric"
            placeholder=" "
            value={value}
            onChange={handleManualInput}
            disabled={disabled}
            style={{ flex: 1 }}
            maxLength={12}
          />
          <label>National ID (12 digits)</label>
          <button
            type="button"
            onClick={startScan}
            disabled={disabled}
            className="btn btn-text"
            style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}
          >
            📷 Scan
          </button>
        </div>
      )}
    </div>
  );
}