import { afterEach, expect, it, vi } from "vitest";
import { reportError, sendErrorReportsTo } from "../report-error";

const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  vi.clearAllMocks();
  sendErrorReportsTo(() => {});
});

it("送り先を登録すると、報告した値を console.error と送り先に 1 回ずつ渡す", () => {
  const send = vi.fn();
  const error = new Error("boom");
  sendErrorReportsTo(send);

  reportError(error);

  expect(consoleError).toHaveBeenCalledExactlyOnceWith(error);
  expect(send).toHaveBeenCalledExactlyOnceWith(error);
});

it("送り先を登録しなければ、console.error に 1 回出すだけで throw しない", async () => {
  vi.resetModules();
  const fresh = await import("../report-error");
  const error = new Error("boom");

  expect(() => fresh.reportError(error)).not.toThrow();
  expect(consoleError).toHaveBeenCalledExactlyOnceWith(error);
});

it("送り先が throw しても、reportError は throw せず、送り先の失敗も console.error に出す", () => {
  const sendFailure = new Error("sentry down");
  const error = new Error("boom");
  sendErrorReportsTo(() => {
    throw sendFailure;
  });

  expect(() => reportError(error)).not.toThrow();
  expect(consoleError.mock.calls).toEqual([[error], [sendFailure]]);
});
