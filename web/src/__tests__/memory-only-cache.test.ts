import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const srcRoot = path.resolve(import.meta.dirname, "..");
const BROWSER_PERSISTENCE =
  /localstorage|sessionstorage|indexeddb|document\.cookie|\bcaches\b|keyvaluestore|atom\.kvs|serializable|\bhydration\b|serializationkey/i;

it("画面の cache は registry のメモリだけに持ち、ブラウザの storage にも Atom の永続の口にも書かない", () => {
  const sourceFiles = readdirSync(srcRoot, {
    recursive: true,
    encoding: "utf8",
  })
    .filter((file) => /\.tsx?$/.test(file) && !file.includes("__tests__"))
    .map((file) => path.join(srcRoot, file));

  expect(sourceFiles.length).toBeGreaterThan(0);
  expect(
    sourceFiles.filter((file) =>
      BROWSER_PERSISTENCE.test(readFileSync(file, "utf8")),
    ),
  ).toEqual([]);
});
