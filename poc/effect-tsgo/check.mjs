import { rmSync, writeFileSync } from "node:fs";
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
const probes = ["src/poc-floating-probe.ts", "web/src/poc-floating-probe.ts"];
const probe = `import { Effect } from "effect";
export const probe = Effect.gen(function* () {
  Effect.log("x");
  yield* Effect.log("y");
});
`;

const candidates = {
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
  // A は node_modules の tsc を書き換えるので最後に流す
  A: [
    [T, "patch", "--typescript"],
    [tsc, "--noEmit"],
    [tsc, "--noEmit", "-p", "web"],
  ],
};

const run = (steps) => {
  rmSync("tsconfig.tsbuildinfo", { force: true });
  rmSync("web/tsconfig.tsbuildinfo", { force: true });
  return steps.map((cmd) =>
    Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" }),
  );
};
const floating = (results) =>
  results.filter((r) =>
    /floatingEffect/.test(r.stdout.toString() + r.stderr.toString()),
  ).length;

console.log(`platform=${process.platform}-${process.arch} exe=${exe}`);
let failed = false;
for (const [name, steps] of Object.entries(candidates)) {
  const clean = run(steps);
  for (const p of probes) writeFileSync(p, probe);
  // 各 step を最後まで流して、root・web のどちらで floatingEffect が出たかを見る
  const violated = run(steps);
  for (const p of probes) rmSync(p);
  const cleanExit = clean.find((r) => r.exitCode !== 0)?.exitCode ?? 0;
  const violatedExits = violated.map((r) => r.exitCode).join(",");
  const ok = cleanExit === 0 && violated.some((r) => r.exitCode !== 0);
  failed ||= !ok;
  console.log(
    `${name} clean_exit=${cleanExit} violated_step_exits=${violatedExits} floating_reports=${floating(violated)} ${ok ? "PASS" : "FAIL"}`,
  );
}
await $`${T} unpatch --typescript`.quiet().nothrow();
process.exit(failed ? 1 : 0);
