import { Result, Schema } from "effect";
import type { Context } from "hono";
import { failureMessage, failureStatus } from "@/src/lib/team-failure";
import type { RequestSession, ServiceResult } from "@/src/services";
import type { TeamFailure } from "@/src/services/team-errors";

export type SessionVariables = {
  Variables: { session: RequestSession };
};

export const encodedJson = <A, I>(
  c: Context,
  schema: Schema.Codec<A, I>,
  value: A,
) => c.json(Schema.encodeSync(schema)(value), 200);

// hc に型を渡すため Response ではなく c.json の戻り値を返す
export const resultJson = <A, I>(
  c: Context,
  schema: Schema.Codec<A, I>,
  result: ServiceResult<A, TeamFailure>,
) => {
  if (Result.isSuccess(result)) return encodedJson(c, schema, result.success);
  const failure = result.failure;
  return c.json(
    { _tag: failure._tag, message: failureMessage(failure) },
    failureStatus(failure),
  );
};
