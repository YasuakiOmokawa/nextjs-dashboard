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
  error: unknown;
  fallbackMessage: string;
  onSubmit: (name: string, options: { onSuccess: () => void }) => void;
}) {
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = new FormData(form).get("name");
    onSubmit(typeof name === "string" ? name : "", {
      onSuccess: () => form.reset(),
    });
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
