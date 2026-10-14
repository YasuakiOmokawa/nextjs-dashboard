import { DatabaseError } from "pg";
import { expect, it } from "vitest";
import { NotManager } from "@/src/spa-contract";
import {
  DbUnavailable,
  defectOf,
  failureOfDbError,
  isUnexpectedFailure,
  MemberListError,
  TeamServiceError,
} from "../failures";

const cause = new Error("connection refused");

it.each([new TeamServiceError({ cause }), new DbUnavailable({ cause })])(
  "DB の失敗 %s は原因の例外を報告する値にする",
  (failure) => {
    expect(defectOf(failure)).toBe(cause);
  },
);

it("メンバー一覧の取得の失敗は、原因を message と cause に付けた listMembers failed の Error を報告する値にする", () => {
  const cause = new Error("UNSPECIFIED");

  const defect = defectOf(new MemberListError({ cause }));

  expect(defect).toBeInstanceOf(Error);
  expect(defect).toEqual(
    expect.objectContaining({
      message: "listMembers failed: Error: UNSPECIFIED",
      cause,
    }),
  );
});

it.each([
  [new MemberListError({ cause }), true],
  [new TeamServiceError({ cause }), true],
  [new DbUnavailable({ cause }), true],
  [new NotManager(), false],
])("%s は予期しない失敗か: %s", (failure, unexpected) => {
  expect(isUnexpectedFailure(failure)).toBe(unexpected);
});

it("DB が答えた失敗 (drizzle が包んだ DatabaseError) は、commit していないので TeamServiceError にする", () => {
  const cause = new Error("Failed query", {
    cause: new DatabaseError("deadlock detected", 0, "error"),
  });

  expect(failureOfDbError(cause)).toEqual(new TeamServiceError({ cause }));
});

it("drizzle を通らない接続の失敗は、commit したか分からないので DbUnavailable にする", () => {
  const cause = new Error("connection refused");

  expect(failureOfDbError(cause)).toEqual(new DbUnavailable({ cause }));
});
