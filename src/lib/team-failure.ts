import { Match, Schema } from "effect";
import { MemberListError } from "@/src/services/company-members-service";
import { DbUnavailable } from "@/src/services/db-service";
import { TeamServiceError } from "@/src/services/team-errors";

const UnexpectedFailure = Schema.Union([
  MemberListError,
  TeamServiceError,
  DbUnavailable,
]);
export type UnexpectedFailure = typeof UnexpectedFailure.Type;

export const isUnexpectedFailure = Schema.is(UnexpectedFailure);

export const defectOf = (failure: UnexpectedFailure): unknown =>
  Match.valueTags(failure, {
    MemberListError: ({ cause }) =>
      new Error(`listMembers failed: ${String(cause)}`, { cause }),
    TeamServiceError: ({ cause }) => cause,
    DbUnavailable: ({ cause }) => cause,
  });
