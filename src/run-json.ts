import { Result, Schema } from "effect";
import type { Context } from "hono";
import { validator } from "hono/validator";
import {
  type ApiFailure,
  failureMessage,
  failureStatus,
  InvalidRequest,
} from "@/src/lib/team-failure";
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

const failureJson = (c: Context, failure: ApiFailure) =>
  c.json(
    { _tag: failure._tag, message: failureMessage(failure) },
    failureStatus(failure),
  );

// hc に型を渡すため Response ではなく c.json の戻り値を返す
export const resultJson = <A, I>(
  c: Context,
  schema: Schema.Codec<A, I>,
  result: ServiceResult<A, TeamFailure>,
) =>
  Result.isSuccess(result)
    ? encodedJson(c, schema, result.success)
    : failureJson(c, result.failure);

// hc は validator の出力の型を送る JSON の型にするので、decode で型の変わる schema は受けない
type TypeSameAsEncoded<S extends Schema.Top> = [S["Type"]] extends [
  S["Encoded"],
]
  ? [S["Encoded"]] extends [S["Type"]]
    ? unknown
    : never
  : never;

export const jsonBody = <S extends Schema.Decoder<unknown>>(
  schema: S & TypeSameAsEncoded<S>,
) => {
  const decode = Schema.decodeUnknownResult<S>(schema);
  return validator("json", (value, c) => {
    const decoded = decode(value);
    return Result.isSuccess(decoded)
      ? decoded.success
      : failureJson(c, new InvalidRequest());
  });
};
