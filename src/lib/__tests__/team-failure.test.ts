import { beforeEach, expect, it, vi } from "vitest";
import {
  MemberListError,
  Unauthenticated,
} from "@/src/services/company-members-service";
import { DbUnavailable } from "@/src/services/db-service";
import {
  DuplicateName,
  InvalidLevel,
  InvalidName,
  NotAssigned,
  NotCompanyMember,
  NotManager,
  SkillNotFound,
  type TeamFailure,
  TeamNotFound,
  TeamServiceError,
} from "@/src/services/team-errors";
import {
  type ApiFailure,
  failureMessage,
  failureStatus,
  InvalidRequest,
  reportUnexpectedFailure,
} from "../team-failure";

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => vi.clearAllMocks());

type Reporting = "reported" | "notReported";
type Handling = readonly [ApiFailure, string, Reporting, number];

const handlingByTag = {
  NotManager: [
    new NotManager(),
    "管理者だけが操作できます",
    "notReported",
    403,
  ],
  TeamNotFound: [
    new TeamNotFound({ teamId: "t" }),
    "チームが見つかりません",
    "notReported",
    404,
  ],
  SkillNotFound: [
    new SkillNotFound(),
    "スキルが見つかりません",
    "notReported",
    404,
  ],
  NotCompanyMember: [
    new NotCompanyMember({ userId: "u" }),
    "事業所のメンバーではありません",
    "notReported",
    422,
  ],
  Unauthenticated: [
    new Unauthenticated({ reason: "SESSION_NOT_FOUND" }),
    "ログインし直してください",
    "notReported",
    401,
  ],
  MemberListError: [
    new MemberListError({ cause: "UNSPECIFIED" }),
    "メンバー一覧を取得できませんでした",
    "reported",
    502,
  ],
  InvalidName: [
    new InvalidName(),
    "名前は 1〜50 文字で入力してください",
    "notReported",
    422,
  ],
  DuplicateName: [
    new DuplicateName(),
    "同じ名前がすでにあります",
    "notReported",
    409,
  ],
  NotAssigned: [
    new NotAssigned(),
    "チームに割り当てられた人だけが記入できます",
    "notReported",
    403,
  ],
  InvalidLevel: [
    new InvalidLevel(),
    "レベルの値が正しくありません",
    "notReported",
    422,
  ],
  TeamServiceError: [
    new TeamServiceError({ cause: "db" }),
    "保存に失敗しました",
    "reported",
    500,
  ],
  InvalidRequest: [
    new InvalidRequest(),
    "送った内容の形が正しくありません",
    "notReported",
    400,
  ],
  DbUnavailable: [
    new DbUnavailable({ cause: "db" }),
    "保存に失敗しました",
    "reported",
    503,
  ],
} satisfies Record<ApiFailure["_tag"], Handling>;

const handlings: readonly Handling[] = Object.values(handlingByTag);

it.each(handlings)("%s の文言", (failure, message) => {
  expect(failureMessage(failure)).toBe(message);
});

it.each(handlings)(
  "%s の状態コード",
  (failure, _message, _reporting, status) => {
    expect(failureStatus(failure)).toBe(status);
  },
);

it.each(handlings.filter(([, , reporting]) => reporting === "reported"))(
  "予期しない失敗 %s は 1 回報告する",
  (failure) => {
    reportUnexpectedFailure(failure);

    expect(consoleError).toHaveBeenCalledOnce();
  },
);

it.each(handlings.filter(([, , reporting]) => reporting === "notReported"))(
  "利用者の操作で起きる失敗 %s は報告しない",
  (failure) => {
    reportUnexpectedFailure(failure);

    expect(consoleError).not.toHaveBeenCalled();
  },
);

const cause = new Error("connection refused");

it.each([new TeamServiceError({ cause }), new DbUnavailable({ cause })])(
  "DB の失敗 %s は原因の例外を報告する",
  (failure) => {
    reportUnexpectedFailure(failure);

    expect(consoleError).toHaveBeenCalledExactlyOnceWith(cause);
  },
);

it("メンバー一覧の取得の失敗は、listMembers failed と reason で報告する", () => {
  reportUnexpectedFailure(new MemberListError({ cause: 2 }));

  expect(consoleError).toHaveBeenCalledExactlyOnceWith("listMembers failed", 2);
});

it("要求の形の失敗は、Service の失敗の型に入らない (bun run typecheck で見る)", () => {
  // @ts-expect-error InvalidRequest は Worker の validator だけが作る
  const serviceFailure: TeamFailure = new InvalidRequest();
  expect(serviceFailure._tag).toBe("InvalidRequest");
});
