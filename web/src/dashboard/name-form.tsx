import type { SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import FailureAlert from "@/dashboard/failure-alert";

export default function NameForm({
  label,
  defaultValue,
  submitLabel,
  pending,
  error,
  fallbackMessage,
  onSubmit,
}: {
  label: string;
  defaultValue?: string;
  submitLabel: string;
  pending: boolean;
  error: Error | null;
  fallbackMessage: string;
  onSubmit: (name: string) => void;
}) {
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get("name");
    onSubmit(typeof name === "string" ? name : "");
  };

  return (
    <form onSubmit={submit} className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="name"
          aria-label={label}
          placeholder={label}
          defaultValue={defaultValue}
          required
          className="w-full max-w-xs rounded-md border-input text-sm"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {submitLabel}
        </Button>
      </div>
      <FailureAlert error={error} fallbackMessage={fallbackMessage} />
    </form>
  );
}
