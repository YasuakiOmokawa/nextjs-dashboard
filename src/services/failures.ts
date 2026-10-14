import { Match, Schema } from "effect";
import { DatabaseError } from "pg";
import type { OperationFailure, Unauthenticated } from "@/src/spa-contract";

export class TeamServiceError extends Schema.TaggedError<TeamServiceError>()(
  "TeamServiceError",
  {
    cause: Schema.Defect(),
  },
) {}

export class DbUnavailable extends Schema.TaggedError<DbUnavailable>()(
  "DbUnavailable",
  {
    cause: Schema.Defect(),
  },
) {}

export class MemberListError extends Schema.TaggedError<MemberListError>()(
  "MemberListError",
  {
    cause: Schema.Defect(),
  },
) {}

const UnexpectedFailure = Schema.Union([
  MemberListError,
  TeamServiceError,
  DbUnavailable,
]);
export type UnexpectedFailure = typeof UnexpectedFailure.Type;

export const isUnexpectedFailure = Schema.is(UnexpectedFailure);

export type TeamFailure =
  | OperationFailure
  | Unauthenticated
  | UnexpectedFailure;

export const defectOf = (failure: UnexpectedFailure): unknown =>
  Match.valueTags(failure, {
    MemberListError: ({ cause }) =>
      new Error(`listMembers failed: ${String(cause)}`, { cause }),
    TeamServiceError: ({ cause }) => cause,
    DbUnavailable: ({ cause }) => cause,
  });

export type DbFailure = TeamServiceError | DbUnavailable;

// drizzle は pg のエラーを cause に包む
export const pgErrorOf = (cause: unknown) =>
  cause instanceof Error && cause.cause instanceof DatabaseError
    ? cause.cause
    : undefined;

// DB が答えた失敗は commit していない。他は接続の失敗で、commit したか分からない
export const failureOfDbError = (cause: unknown): DbFailure =>
  pgErrorOf(cause)
    ? new TeamServiceError({ cause })
    : new DbUnavailable({ cause });
