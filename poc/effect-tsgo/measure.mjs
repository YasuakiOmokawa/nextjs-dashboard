import { rmSync } from "node:fs";
import { $ } from "bun";

const root = new URL("../..", import.meta.url).pathname;
process.chdir(root);
const T = "node_modules/.bin/effect-tsgo";
const exe = (await $`${T} get-exe-path`.text()).trim();
const tsc = "node_modules/.bin/tsc";
const diag = (p) => [
  T,
  "diagnostics",
  "--project",
  `${root}${p}`,
  "--format",
  "text",
];

const candidates = {
  base: [
    [tsc, "--noEmit"],
    [tsc, "--noEmit", "-p", "web"],
  ],
  B: [
    [tsc, "--noEmit"],
    [tsc, "--noEmit", "-p", "web"],
    diag("tsconfig.json"),
    diag("web/tsconfig.json"),
  ],
  D: [
    [exe, "--noEmit"],
    [exe, "--noEmit", "-p", "web"],
  ],
  A: [
    [T, "patch", "--typescript"],
    [tsc, "--noEmit"],
    [tsc, "--noEmit", "-p", "web"],
  ],
};

for (const [name, steps] of Object.entries(candidates)) {
  for (const run of [1, 2, 3]) {
    rmSync("tsconfig.tsbuildinfo", { force: true });
    rmSync("web/tsconfig.tsbuildinfo", { force: true });
    const start = performance.now();
    let exitCode = 0;
    for (const cmd of steps) {
      exitCode = Bun.spawnSync(cmd, {
        stdout: "ignore",
        stderr: "ignore",
      }).exitCode;
      if (exitCode !== 0) break;
    }
    console.log(
      `${name} run${run} exit=${exitCode} ms=${Math.round(performance.now() - start)}`,
    );
  }
}
await $`${T} unpatch --typescript`.quiet();
