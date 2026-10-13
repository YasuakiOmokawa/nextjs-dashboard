import { failureMessageOf, type ShownFailure } from "@/api";

export default function FailureAlert({
  failure,
  fallbackMessage,
}: {
  failure: ShownFailure | undefined;
  fallbackMessage: string;
}) {
  if (!failure) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {failureMessageOf(failure, fallbackMessage)}
    </p>
  );
}
