import { useSearchParams } from "next/navigation";

const DEFAULT_REDIRECT_PATH = "/dashboard";

export const useRedirectPath = (): string => {
  const callbackUrl = useSearchParams().get("callbackUrl");
  return callbackUrl ? new URL(callbackUrl).pathname : DEFAULT_REDIRECT_PATH;
};
