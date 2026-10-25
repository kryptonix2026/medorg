interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export default function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div style={{ width: 48, height: 48, borderRadius: "50%", background: "var(--color-error-bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: 24 }}>⚠</span>
      </div>
      <p style={{ color: "var(--color-error-text)", textAlign: "center", maxWidth: 320 }}>{message}</p>
      {onRetry && (
        <button className="btn btn-outlined" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}