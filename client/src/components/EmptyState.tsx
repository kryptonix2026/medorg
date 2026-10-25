interface EmptyStateProps {
  title: string;
  message: string;
  action?: React.ReactNode;
}

export default function EmptyState({ title, message, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div style={{ width: 80, height: 80, borderRadius: "50%", background: "var(--color-surface-variant)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--color-blue)", opacity: 0.3 }} />
      </div>
      <h3 style={{ fontSize: 18, fontWeight: 500 }}>{title}</h3>
      <p className="text-secondary" style={{ textAlign: "center", maxWidth: 320 }}>{message}</p>
      {action}
    </div>
  );
}