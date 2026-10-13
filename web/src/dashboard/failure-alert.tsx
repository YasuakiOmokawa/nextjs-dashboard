import { failureMessageOf } from "@/api";

export default function FailureAlert({
  error,
  fallbackMessage,
}: {
  error: unknown;
  fallbackMessage: string;
}) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {failureMessageOf(error, fallbackMessage)}
    </p>
  );
}
