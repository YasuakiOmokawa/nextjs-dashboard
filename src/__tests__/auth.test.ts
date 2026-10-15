import { afterEach, describe, expect, it, vi } from "vitest";
import { type AuthEnv, authGuardOf } from "../auth";

const sessionNotFound = () =>
  Response.json({ error: { reason: "RESULT_SESSION_NOT_FOUND" } });

const bindingEnv = (env: Partial<AuthEnv> = {}) => {
  const binding = vi.fn<typeof fetch>(async () => sessionNotFound());
  return {
    binding,
    env: {
      AUTH: { fetch: binding },
      AUTH_URL: "https://auth.example",
      ...env,
    },
  };
};

const cookie = "better-auth.session_token=tok";

const sentRequest = (spy: ReturnType<typeof vi.fn<typeof fetch>>) => {
  const [input, init] = spy.mock.calls[0];
  return { url: String(input), init: init ?? {} };
};

afterEach(() => vi.unstubAllGlobals());

describe("authGuardOf の verifySession", () => {
  it("AUTH_SERVICE_URL が無ければ、binding に GetSession を POST する", async () => {
    const { binding, env } = bindingEnv();

    await authGuardOf(env, cookie).verifySession();

    expect(binding).toHaveBeenCalledOnce();
    const { url, init } = sentRequest(binding);
    expect(new URL(url).pathname).toBe("/rpc/auth.v1.AuthService/GetSession");
    expect(init.method).toBe("POST");
  });

  it("AUTH_SERVICE_URL があれば、その URL へ global の fetch で送り、binding を呼ばない", async () => {
    const global = vi.fn<typeof fetch>(async () => sessionNotFound());
    vi.stubGlobal("fetch", global);
    const { binding, env } = bindingEnv({
      AUTH_SERVICE_URL: "http://auth.local:3100",
    });

    await authGuardOf(env, cookie).verifySession();

    expect(sentRequest(global).url).toBe(
      "http://auth.local:3100/rpc/auth.v1.AuthService/GetSession",
    );
    expect(binding).not.toHaveBeenCalled();
  });

  it("AUTH_SERVICE_KEY があれば X-Service-Key で送る", async () => {
    const { binding, env } = bindingEnv({ AUTH_SERVICE_KEY: "key-1" });

    await authGuardOf(env, cookie).verifySession();

    expect(
      new Headers(sentRequest(binding).init.headers).get("X-Service-Key"),
    ).toBe("key-1");
  });

  it("AUTH_SERVICE_KEY が無ければ X-Service-Key を送らない", async () => {
    const { binding, env } = bindingEnv();

    await authGuardOf(env, cookie).verifySession();

    expect(
      new Headers(sentRequest(binding).init.headers).has("X-Service-Key"),
    ).toBe(false);
  });

  it("redirect を manual にして送る", async () => {
    const { binding, env } = bindingEnv();

    await authGuardOf(env, cookie).verifySession();

    expect(sentRequest(binding).init.redirect).toBe("manual");
  });

  it("10 秒で打ち切る", async () => {
    const { binding, env } = bindingEnv();

    await authGuardOf(env, cookie).verifySession();

    expect(
      new Headers(sentRequest(binding).init.headers).get("Connect-Timeout-Ms"),
    ).toBe("10000");
  });
});

const sessionOkFor = (companyId: string) =>
  Response.json({
    ok: {
      user: {
        id: "u_1",
        name: "山田 花子",
        email: "hanako@example.com",
        emailVerified: true,
        createdAt: "2026-10-10T00:00:00.000Z",
        updatedAt: "2026-10-10T00:00:00.000Z",
        defaultCompanyId: companyId,
      },
      session: { id: "s_1", expiresAt: "2099-01-01T00:00:00.000Z" },
    },
  });

describe("authGuardOf の memo", () => {
  it("同じ guard の verifySession を 2 回呼んでも、taimei-auth へは 1 回だけ送る", async () => {
    const { binding, env } = bindingEnv();
    const guard = authGuardOf(env, cookie);

    const first = await guard.verifySession();
    const second = await guard.verifySession();

    expect(binding).toHaveBeenCalledOnce();
    expect(second).toBe(first);
  });

  it("別の cookie の guard は memo を共有せず、それぞれの token で送る", async () => {
    const { binding, env } = bindingEnv();

    await Promise.all([
      authGuardOf(env, "better-auth.session_token=tok_a").verifySession(),
      authGuardOf(env, "better-auth.session_token=tok_b").verifySession(),
    ]);

    expect(
      await Promise.all(
        binding.mock.calls.map(
          async ([input, init]) =>
            (await new Request(String(input), init).json()).sessionToken,
        ),
      ),
    ).toEqual(["tok_a", "tok_b"]);
  });
});

describe("authGuardOf の listMembers", () => {
  it("verifySession と listMembers を呼んでも、cookie の session token で GetSession を 1 回だけ送る", async () => {
    const binding = vi.fn<typeof fetch>(async () => sessionOkFor("cmp_a"));
    const guard = authGuardOf(
      { AUTH: { fetch: binding }, AUTH_URL: "https://auth.example" },
      cookie,
    );

    await guard.verifySession();
    await guard.listMembers();

    expect(binding).toHaveBeenCalledOnce();
    const { url, init } = sentRequest(binding);
    expect(new URL(url).pathname).toBe("/rpc/auth.v1.AuthService/GetSession");
    expect((await new Request(url, init).json()).sessionToken).toBe("tok");
  });
});
