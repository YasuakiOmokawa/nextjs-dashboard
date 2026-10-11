import { failureMessageOf } from "@/api";

export default function FailureAlert({
  error,
  fallbackMessage,
}: {
  error: Error | null;
  fallbackMessage: string;
}) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {failureMessageOf(error, fallbackMessage)}
    </p>
  );
}
