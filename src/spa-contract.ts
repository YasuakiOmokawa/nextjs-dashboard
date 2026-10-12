import { Context, Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/http-api";
// SPA の build の alias は @ を web/src に向けるので、repo 内は相対で読む
import { LEVELS } from "../db/column-values";
import { SkillId, TeamId } from "../db/ids";
import type { RequestSession } from "./services";

export const SESSION_HEADER = "x-taimei-session";

export class Unauthenticated extends Schema.TaggedError<Unauthenticated>()(
  "Unauthenticated",
  {},
  { httpApiStatus: 401 },
) {}

export class SessionChanged extends Schema.TaggedError<SessionChanged>()(
  "SessionChanged",
  {},
  { httpApiStatus: 409 },
) {}

export class NotManager extends Schema.TaggedError<NotManager>()(
  "NotManager",
  {},
  { httpApiStatus: 403 },
) {}

export class TeamNotFound extends Schema.TaggedError<TeamNotFound>()(
  "TeamNotFound",
  { teamId: Schema.String },
  { httpApiStatus: 404 },
) {}

export class SkillNotFound extends Schema.TaggedError<SkillNotFound>()(
  "SkillNotFound",
  {},
  { httpApiStatus: 404 },
) {}

export class NotCompanyMember extends Schema.TaggedError<NotCompanyMember>()(
  "NotCompanyMember",
  { userId: Schema.String },
  { httpApiStatus: 422 },
) {}

export class InvalidName extends Schema.TaggedError<InvalidName>()(
  "InvalidName",
  {},
  { httpApiStatus: 422 },
) {}

export class DuplicateName extends Schema.TaggedError<DuplicateName>()(
  "DuplicateName",
  {},
  { httpApiStatus: 409 },
) {}

export class NotAssigned extends Schema.TaggedError<NotAssigned>()(
  "NotAssigned",
  {},
  { httpApiStatus: 403 },
) {}

export class InvalidLevel extends Schema.TaggedError<InvalidLevel>()(
  "InvalidLevel",
  {},
  { httpApiStatus: 422 },
) {}

export const OperationFailure = Schema.Union([
  NotManager,
  TeamNotFound,
  SkillNotFound,
  NotCompanyMember,
  InvalidName,
  DuplicateName,
  NotAssigned,
  InvalidLevel,
]);
export type OperationFailure = typeof OperationFailure.Type;

export const Level = Schema.Literals(LEVELS);
export type Level = typeof Level.Type;

export const Team = Schema.Struct({ id: TeamId, name: Schema.String });

export const TeamDetail = Schema.Struct({
  ...Team.fields,
  skills: Schema.Array(Schema.Struct({ id: SkillId, name: Schema.String })),
  assignedUserIds: Schema.Array(Schema.String),
  levels: Schema.Array(
    Schema.Struct({
      userId: Schema.String,
      skillId: SkillId,
      level: Level,
      wantsToLearn: Schema.Boolean,
    }),
  ),
});

const TeamPage = Schema.Struct({
  team: TeamDetail,
  members: Schema.NullOr(
    Schema.Array(Schema.Struct({ userId: Schema.String, name: Schema.String })),
  ),
});
export type TeamPage = typeof TeamPage.Type;

// 1 文の INSERT の bind parameter は PostgreSQL の上限 65535 個 (1 entry に 6 個) を超えられない
export const MAX_LEVEL_ENTRIES_PER_SAVE = 1000;

const LevelEntry = Schema.Struct({
  skillId: Schema.String,
  level: Schema.Number,
  wantsToLearn: Schema.Boolean,
});
export type LevelEntry = typeof LevelEntry.Type;

const NameRequest = Schema.Struct({ name: Schema.String });
const Empty = Schema.Struct({});

export class CurrentSession extends Context.Service<
  CurrentSession,
  RequestSession
>()("taimei/CurrentSession") {}

export class Authenticated extends HttpApiMiddleware.Service<
  Authenticated,
  { provides: CurrentSession }
>()("taimei/Authenticated", { error: [Unauthenticated, SessionChanged] }) {}

const teamParams = { teamId: Schema.String };

export class MeGroup extends HttpApiGroup.make("me").add(
  HttpApiEndpoint.get("get", "/api/me", {
    success: Schema.Struct({
      userId: Schema.String,
      name: Schema.String,
      canManage: Schema.Boolean,
    }),
  }),
) {}

export class TeamsGroup extends HttpApiGroup.make("teams").add(
  HttpApiEndpoint.get("list", "/api/teams", {
    success: Schema.Struct({ teams: Schema.Array(Team) }),
  }),
  HttpApiEndpoint.post("create", "/api/teams", {
    payload: NameRequest,
    success: Schema.Struct({ id: Schema.String }),
    error: [NotManager, InvalidName, DuplicateName],
  }),
  HttpApiEndpoint.get("get", "/api/teams/:teamId", {
    params: teamParams,
    success: TeamPage,
    error: [TeamNotFound, Unauthenticated],
  }),
  HttpApiEndpoint.patch("rename", "/api/teams/:teamId", {
    params: teamParams,
    payload: NameRequest,
    success: Empty,
    error: [NotManager, TeamNotFound, InvalidName, DuplicateName],
  }),
  HttpApiEndpoint.delete("delete", "/api/teams/:teamId", {
    params: teamParams,
    success: Empty,
    error: [NotManager, TeamNotFound],
  }),
  HttpApiEndpoint.post("addSkill", "/api/teams/:teamId/skills", {
    params: teamParams,
    payload: NameRequest,
    success: Empty,
    error: [NotManager, TeamNotFound, InvalidName, DuplicateName],
  }),
  HttpApiEndpoint.delete("removeSkill", "/api/skills/:skillId", {
    params: { skillId: Schema.String },
    success: Empty,
    error: [NotManager, SkillNotFound],
  }),
  HttpApiEndpoint.put("assign", "/api/teams/:teamId/assignments/:userId", {
    params: { ...teamParams, userId: Schema.String },
    success: Empty,
    error: [NotManager, TeamNotFound, NotCompanyMember, Unauthenticated],
  }),
  HttpApiEndpoint.delete("unassign", "/api/teams/:teamId/assignments/:userId", {
    params: { ...teamParams, userId: Schema.String },
    success: Empty,
    error: [NotManager, TeamNotFound],
  }),
  HttpApiEndpoint.put("saveMyLevels", "/api/teams/:teamId/my-levels", {
    params: teamParams,
    payload: Schema.Struct({
      levels: Schema.Array(LevelEntry).check(
        Schema.isMaxLength(MAX_LEVEL_ENTRIES_PER_SAVE),
      ),
    }),
    success: Empty,
    error: [TeamNotFound, SkillNotFound, NotAssigned, InvalidLevel],
  }),
) {}

export class MembersGroup extends HttpApiGroup.make("members").add(
  HttpApiEndpoint.get("list", "/api/members", {
    success: Schema.Struct({
      members: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          email: Schema.String,
          role: Schema.optionalKey(
            Schema.Literals(["OWNER", "ADMIN", "MEMBER"]),
          ),
        }),
      ),
    }),
    error: Unauthenticated,
  }),
) {}

export class SpaApi extends HttpApi.make("spa")
  .add(MeGroup)
  .add(TeamsGroup)
  .add(MembersGroup)
  .middleware(Authenticated) {}
