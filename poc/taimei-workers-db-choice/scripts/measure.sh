#!/usr/bin/env bash
# usage: measure.sh <worker-dir> <base-url> <token> <label> <path>...
# 各 path を交互に、20 巡慣らした後に 200 巡直列で叩く。curl の time_starttransfer と wrangler tail の cpuTime / wallTime を out/<label>/ に残す
set -euo pipefail
dir=$1 base=$2 token=$3 label=$4
shift 4
here=$(cd "$(dirname "$0")/.." && pwd)
out=$here/out/$label
mkdir -p "$out"

(cd "$here/$dir" && exec "$here/node_modules/.bin/wrangler" tail --format json >"$out/tail.jsonl" 2>"$out/tail.err") &
tail_pid=$!
sleep 8

for _ in $(seq 20); do for p in "$@"; do curl -s -o /dev/null -H "authorization: Bearer $token" "$base$p"; done; done
: >"$out/ttfb.txt"
for _ in $(seq 200); do
  for p in "$@"; do
    curl -s -o /dev/null -w "$p %{http_code} %{time_starttransfer}\n" -H "authorization: Bearer $token" "$base$p" >>"$out/ttfb.txt"
  done
done
sleep 8
kill "$tail_pid" 2>/dev/null || true
wait "$tail_pid" 2>/dev/null || true
python3 "$here/scripts/summarize.py" "$out"
