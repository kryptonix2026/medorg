interface StatusBadgeProps {
  status: string;
  type?: "access" | "record";
}

export default function StatusBadge({ status, type = "access" }: StatusBadgeProps) {
  if (type === "record") {
    return (
      <span className={`record-badge record-${status.toLowerCase()}`}>
        {status}
      </span>
    );
  }

  return (
    <span className={`status-badge status-${status.toLowerCase()}`}>
      {status}
    </span>
  );
}