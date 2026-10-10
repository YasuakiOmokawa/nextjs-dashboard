import { Match } from "effect";
import { NAME_MAX_LENGTH } from "@/db/drizzle/schema";
import type { TeamFailure } from "@/src/services/team-errors";

// hc は状態コードで応答の型を絞るので、成功の 2xx を混ぜない
type FailureStatus = 401 | 403 | 404 | 409 | 422 | 500 | 502 | 503;

type FailureHandling = {
  readonly message: string;
  readonly status: FailureStatus;
  readonly report: (() => void) | undefined;
};

const expectedFailure = (
  message: string,
  status: FailureStatus,
): FailureHandling => ({
  message,
  status,
  report: undefined,
});

const unexpectedFailure = (
  message: string,
  status: FailureStatus,
  report: () => void,
): FailureHandling => ({
  message,
  status,
  report,
});

const unexpectedDbFailure =
  (status: FailureStatus) =>
  ({ cause }: { readonly cause: unknown }) =>
    unexpectedFailure("保存に失敗しました", status, () => console.error(cause));

const handlingOf = (failure: TeamFailure) =>
  Match.valueTags(failure, {
    NotManager: () => expectedFailure("管理者だけが操作できます", 403),
    TeamNotFound: () => expectedFailure("チームが見つかりません", 404),
    SkillNotFound: () => expectedFailure("スキルが見つかりません", 404),
    NotCompanyMember: () =>
      expectedFailure("事業所のメンバーではありません", 422),
    InvalidName: () =>
      expectedFailure(
        `名前は 1〜${NAME_MAX_LENGTH} 文字で入力してください`,
        422,
      ),
    DuplicateName: () => expectedFailure("同じ名前がすでにあります", 409),
    NotAssigned: () =>
      expectedFailure("チームに割り当てられた人だけが記入できます", 403),
    InvalidLevel: () => expectedFailure("レベルの値が正しくありません", 422),
    Unauthenticated: () => expectedFailure("ログインし直してください", 401),
    MemberListError: ({ cause }) =>
      unexpectedFailure("メンバー一覧を取得できませんでした", 502, () =>
        console.error("listMembers failed", cause),
      ),
    TeamServiceError: unexpectedDbFailure(500),
    DbUnavailable: unexpectedDbFailure(503),
  });

export const failureMessage = (failure: TeamFailure) =>
  handlingOf(failure).message;

export const failureStatus = (failure: TeamFailure) =>
  handlingOf(failure).status;

export const reportUnexpectedFailure = (failure: TeamFailure) =>
  handlingOf(failure).report?.();
