import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const dependencies = new Set(
  Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies }),
);

const git = (...args: string[]) =>
  execFileSync("git", args, { encoding: "utf8" }).trim().split("\n");

const trackedPaths = git("ls-files");

const claudeMdFiles = trackedPaths.filter(
  (path) => path.endsWith("CLAUDE.md") && !path.startsWith("vendor/"),
);

const quotedTokensOf = (path: string) =>
  [...readFileSync(path, "utf8").matchAll(/`([^`\n]+)`/g)].map(
    (match) => match[1],
  );

const PATH_LIKE = /^[\w@][\w.@-]*(\/[\w.@-]+)*\/?$/;
const FILE_EXTENSION = /\.(ts|tsx|js|mjs|json|jsonc|md|sql|yml|html|pem)$/;
const isRepoPath = (token: string) =>
  PATH_LIKE.test(token) && (token.includes("/") || FILE_EXTENSION.test(token));

const packageOf = (specifier: string) =>
  specifier
    .split("/")
    .slice(0, specifier.startsWith("@") ? 2 : 1)
    .join("/");

const pathExists = (token: string) => {
  const path = token.replace(/\/$/, "");
  return (
    trackedPaths.some(
      (tracked) =>
        tracked === path ||
        tracked.endsWith(`/${path}`) ||
        tracked.startsWith(`${path}/`) ||
        tracked.includes(`/${path}/`),
    ) ||
    existsSync(path) ||
    dependencies.has(packageOf(path))
  );
};

// 小文字だけの 1 語 (`db`・`make`) は一般の語と区別できないので見ない
const IDENTIFIER = /^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/;
const isCodeIdentifier = (token: string) =>
  IDENTIFIER.test(token) && /[A-Z_.]/.test(token) && !isRepoPath(token);

const appearsInCode = (token: string) => {
  const name = token.split(".").at(-1) ?? token;
  try {
    execFileSync("git", ["grep", "-q", "-w", "-F", name, "--", ":!*.md"]);
    return true;
  } catch {
    return false;
  }
};

const references = claudeMdFiles.flatMap((claudeMd) =>
  [...new Set(quotedTokensOf(claudeMd))].map((token) => ({ claudeMd, token })),
);

describe("CLAUDE.md が `` で囲んで書く参照は、今の repo に実在する", () => {
  it.each(references.filter(({ token }) => isRepoPath(token)))(
    "$claudeMd の path `$token` は repo の file・directory か依存の package を指す",
    ({ token }) => {
      expect(pathExists(token)).toBe(true);
    },
  );

  it.each(references.filter(({ token }) => isCodeIdentifier(token)))(
    "$claudeMd の識別子 `$token` は CLAUDE.md の外のコードに現れる",
    ({ token }) => {
      expect(appearsInCode(token)).toBe(true);
    },
  );
});
