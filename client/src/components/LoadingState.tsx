interface LoadingStateProps {
  message?: string;
}

export default function LoadingState({ message = "Loading..." }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="gradient-strip" style={{ width: 120, borderRadius: 4 }} />
      <div className="skeleton" style={{ width: 200, height: 16 }} />
      <div className="skeleton" style={{ width: 160, height: 12 }} />
      <p className="text-secondary" style={{ fontSize: 14 }}>{message}</p>
    </div>
  );
}