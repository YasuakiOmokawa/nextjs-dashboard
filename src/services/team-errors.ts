import { Effect, Schema } from "effect";
import { TeamId } from "@/db/ids";
import {
  type DuplicateName,
  type InvalidLevel,
  type InvalidName,
  type NotAssigned,
  type NotCompanyMember,
  type NotManager,
  type SkillNotFound,
  TeamNotFound,
  type Unauthenticated,
} from "@/src/spa-contract";
import type { MemberListError } from "./company-members-service";
import type { DbUnavailable } from "./db-service";

const decodeUnknownTeamId = Schema.decodeUnknownEffect(TeamId);
export const decodeTeamId = (teamId: string) =>
  decodeUnknownTeamId(teamId).pipe(
    Effect.mapError(() => new TeamNotFound({ teamId })),
  );

export class TeamServiceError extends Schema.TaggedError<TeamServiceError>()(
  "TeamServiceError",
  {
    cause: Schema.Defect(),
  },
) {}

export type TeamFailure =
  | NotManager
  | TeamNotFound
  | SkillNotFound
  | NotCompanyMember
  | MemberListError
  | Unauthenticated
  | InvalidName
  | DuplicateName
  | NotAssigned
  | InvalidLevel
  | TeamServiceError
  | DbUnavailable;
