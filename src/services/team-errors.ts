import { Effect, Schema } from "effect";
import { TeamId } from "@/db/ids";
import type {
  MemberListError,
  Unauthenticated,
} from "./company-members-service";
import type { DbUnavailable } from "./db-service";

export class TeamNotFound extends Schema.TaggedError<TeamNotFound>()(
  "TeamNotFound",
  {
    teamId: Schema.String,
  },
) {}

const decodeUnknownTeamId = Schema.decodeUnknownEffect(TeamId);
export const decodeTeamId = (teamId: string) =>
  decodeUnknownTeamId(teamId).pipe(
    Effect.mapError(() => new TeamNotFound({ teamId })),
  );

export class SkillNotFound extends Schema.TaggedError<SkillNotFound>()(
  "SkillNotFound",
  {},
) {}

export class NotManager extends Schema.TaggedError<NotManager>()(
  "NotManager",
  {},
) {}

export class NotCompanyMember extends Schema.TaggedError<NotCompanyMember>()(
  "NotCompanyMember",
  {
    userId: Schema.String,
  },
) {}

export class InvalidName extends Schema.TaggedError<InvalidName>()(
  "InvalidName",
  {},
) {}

export class DuplicateName extends Schema.TaggedError<DuplicateName>()(
  "DuplicateName",
  {},
) {}

export class NotAssigned extends Schema.TaggedError<NotAssigned>()(
  "NotAssigned",
  {},
) {}

export class InvalidLevel extends Schema.TaggedError<InvalidLevel>()(
  "InvalidLevel",
  {},
) {}

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
