#!/usr/bin/env bash
# 候補 2 は既存の db/ (schema・ids・scoped) を変えずに使う。worktree の直下に node_modules が無く
# bundler が依存を解決できないので、build の前に PoC の中へ写す
set -euo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
root=$(cd "$here/../.." && pwd)
dst=$here/neon/src/repo-db
rm -rf "$dst" && mkdir -p "$dst/drizzle"
cp "$root/db/ids.ts" "$root/db/scoped.ts" "$dst/"
cp "$root/db/drizzle/schema.ts" "$dst/drizzle/"
