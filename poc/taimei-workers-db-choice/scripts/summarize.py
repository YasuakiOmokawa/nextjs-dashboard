import json, math, sys
from collections import defaultdict

out = sys.argv[1]


def pct(xs, p):
    xs = sorted(xs)
    return xs[max(0, math.ceil(p / 100 * len(xs)) - 1)]


def stats(xs):
    return {"n": len(xs), "p50": pct(xs, 50), "p95": pct(xs, 95), "max": max(xs)} if xs else None


ttfb, codes = defaultdict(list), defaultdict(set)
for line in open(f"{out}/ttfb.txt"):
    path, code, t = line.split()
    ttfb[path].append(round(float(t) * 1000, 1))
    codes[path].add(code)

# wrangler tail --format json は整形済みの JSON を連結して出す
text, dec, events, i = open(f"{out}/tail.jsonl").read(), json.JSONDecoder(), [], 0
while (i := text.find("{", i)) != -1:
    e, i = dec.raw_decode(text, i)
    events.append(e)

cpu, wall = defaultdict(list), defaultdict(list)
for e in events:
    ev = e.get("event") or {}
    url = ev.get("request", {}).get("url", "")
    key = next((p for p in ttfb if url.endswith(p.split("/")[-1]) and p.split("/")[1] in url), None)
    key = key or (f"rpc:{ev['rpcMethod']}" if "rpcMethod" in ev else "other")
    cpu[key].append(e.get("cpuTime", 0))
    wall[key].append(e.get("wallTime", 0))

summary = {
    p: {"codes": sorted(codes.get(p, [])), "ttfb_ms": stats(ttfb.get(p, [])), "cpu_ms": stats(cpu.get(p, [])), "wall_ms": stats(wall.get(p, []))}
    for p in sorted(set(ttfb) | set(cpu))
}
json.dump(summary, open(f"{out}/summary.json", "w"), indent=1)
print(json.dumps(summary, ensure_ascii=False))
