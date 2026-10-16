import {
  buildSessionCookieHeader,
  createServiceKeyInterceptor,
} from "@taimei-code/auth-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AuthEnv,
  authGuardOf,
  authTransportOptionsOf,
  once,
} from "../auth";

vi.mock("@taimei-code/auth-client", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@taimei-code/auth-client")>();
  return {
    ...sdk,
    createServiceKeyInterceptor: vi.fn(sdk.createServiceKeyInterceptor),
  };
});

const bindingEnv = (env: Partial<AuthEnv> = {}) => {
  const binding = vi.fn<typeof fetch>(async () => new Response());
  return {
    binding,
    env: {
      AUTH: { fetch: binding },
      AUTH_URL: "https://auth.example",
      ...env,
    },
  };
};

const ANY_URL = "https://taimei-auth/any";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(createServiceKeyInterceptor).mockClear();
});

describe("authTransportOptionsOf", () => {
  it("AUTH_SERVICE_URL が無ければ、送り先は Service Binding が URL を使わない origin の /rpc", () => {
    expect(authTransportOptionsOf(bindingEnv().env).baseUrl).toBe(
      "https://taimei-auth/rpc",
    );
  });

  it("AUTH_SERVICE_URL があれば、送り先はその URL の /rpc", () => {
    const { env } = bindingEnv({ AUTH_SERVICE_URL: "http://auth.local:3100" });

    expect(authTransportOptionsOf(env).baseUrl).toBe(
      "http://auth.local:3100/rpc",
    );
  });

  it("AUTH_SERVICE_URL が無ければ binding へ送り、redirect は workerd の fetch が受ける manual にする (connect-web は error を付ける)", async () => {
    const globalFetch = vi.fn<typeof fetch>(async () => new Response());
    vi.stubGlobal("fetch", globalFetch);
    const { binding, env } = bindingEnv();

    await authTransportOptionsOf(env).fetch(ANY_URL, { redirect: "error" });

    expect(binding).toHaveBeenCalledOnce();
    expect(binding.mock.calls[0][1]?.redirect).toBe("manual");
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("AUTH_SERVICE_URL があれば (手元と e2e の Bun の taimei-auth には Service Binding が届かない)、global の fetch へ redirect: manual で送り、binding を呼ばない", async () => {
    const globalFetch = vi.fn<typeof fetch>(async () => new Response());
    vi.stubGlobal("fetch", globalFetch);
    const { binding, env } = bindingEnv({
      AUTH_SERVICE_URL: "http://auth.local:3100",
    });

    await authTransportOptionsOf(env).fetch(ANY_URL, { redirect: "error" });

    expect(globalFetch).toHaveBeenCalledOnce();
    expect(globalFetch.mock.calls[0][1]?.redirect).toBe("manual");
    expect(binding).not.toHaveBeenCalled();
  });

  it("10 秒で打ち切る", () => {
    expect(authTransportOptionsOf(bindingEnv().env).defaultTimeoutMs).toBe(
      10_000,
    );
  });

  it("AUTH_SERVICE_KEY があれば、その値で作った Service Key の interceptor だけを付ける", () => {
    const { env } = bindingEnv({ AUTH_SERVICE_KEY: "key-1" });

    const { interceptors } = authTransportOptionsOf(env);

    expect(createServiceKeyInterceptor).toHaveBeenCalledExactlyOnceWith(
      "key-1",
    );
    expect(interceptors).toEqual([
      vi.mocked(createServiceKeyInterceptor).mock.results[0].value,
    ]);
  });

  it("AUTH_SERVICE_KEY が無ければ interceptor を付けない", () => {
    expect(authTransportOptionsOf(bindingEnv().env).interceptors).toEqual([]);
  });
});

describe("authGuardOf", () => {
  it("1 要求の getSession と listMembers で、要求の cookie を持って taimei-auth へ 1 回だけ送る", async () => {
    const { binding, env } = bindingEnv();
    const guard = authGuardOf(env, buildSessionCookieHeader("tok"));

    await guard.getSession();
    await guard.listMembers();

    expect(binding).toHaveBeenCalledOnce();
  });

  it("別の要求の guard は結果を共有せず、それぞれ送る", async () => {
    const { binding, env } = bindingEnv();

    await authGuardOf(env, buildSessionCookieHeader("tok_a")).getSession();
    await authGuardOf(env, buildSessionCookieHeader("tok_b")).getSession();

    expect(binding).toHaveBeenCalledTimes(2);
  });
});

describe("once", () => {
  it("引数を見ずに最初の呼び出しの結果を返し続け、包んだ関数を 1 回だけ呼ぶ (SDK が cache で包むのは引数の無い関数だけ)", () => {
    const fn = vi.fn(() => ({}));
    const cached = once(fn);

    const first = cached();
    const second = cached();

    expect(fn).toHaveBeenCalledOnce();
    expect(second).toBe(first);
  });

  it("別々に包んだ関数は結果を共有しない", () => {
    const a = once(() => "a");
    const b = once(() => "b");

    expect([a(), b()]).toEqual(["a", "b"]);
  });
});
