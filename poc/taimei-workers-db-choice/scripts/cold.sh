#!/usr/bin/env bash
# usage: cold.sh <rounds> <idle-seconds>
# 両案の Worker を idle-seconds 休ませた後に星取表を 1 回ずつ読む (Neon は 5 分で compute が止まり、DO も memory から追い出される)
set -euo pipefail
rounds=$1 idle=$2
here=$(cd "$(dirname "$0")/.." && pwd)
out=$here/out/cold
mkdir -p "$out"
secret=$(sed -n 's/^POC_SECRET=//p' "$here/do/.dev.vars")
read -r do_team _ <"$here/out-do-ids.txt"
read -r neon_team _ <"$here/out-neon-ids.txt"
for w in do neon; do
  (cd "$here/$w" && exec "$here/node_modules/.bin/wrangler" tail --format json >"$out/tail-$w.jsonl" 2>/dev/null) &
done
sleep 8
: >"$out/ttfb.txt"
for r in $(seq "$rounds"); do
  sleep "$idle"
  for pair in "do https://taimei-poc-do.omokawa.workers.dev/api/teams/$do_team/matrix" "neon https://taimei-poc-neon.omokawa.workers.dev/api/teams/$neon_team/matrix"; do
    set -- $pair
    curl -s -o /dev/null -w "$r $1 %{http_code} %{time_starttransfer}\n" -H "authorization: Bearer $secret:cmp_a" "$2" >>"$out/ttfb.txt"
  done
done
sleep 8
kill $(jobs -p) 2>/dev/null || true
cat "$out/ttfb.txt"
