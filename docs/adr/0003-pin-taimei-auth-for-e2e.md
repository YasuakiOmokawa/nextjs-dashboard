# ADR-0003: e2e が使う taimei-auth を commit で固定し、Dependabot で週次に上げる

- **Status**: Accepted
- **実装**: submodule `vendor/taimei-auth` を taimei-auth `21ca282` に固定し、`e2e.yml` / `docker-compose.e2e.yml` / `.github/dependabot.yml` を切り替えた。Dependabot の secret への `NPM_TOKEN` の登録 (Consequences の前提条件) は未了
- **Date**: 2026-09-24 (改訂 2026-10-15)
- **References**: [taimei-code/taimei-auth#224](https://github.com/taimei-code/taimei-auth/pull/224) (契約違反の実例)、[taimei-code/taimei-auth#225](https://github.com/taimei-code/taimei-auth/pull/225) (契約 test)、taimei-auth の `docs/qa/manual-regression.md` QA-MR-09

## Context

taimei は taimei-auth に 2 つの経路で依存している。

| 経路 | 今の固定 | 変更が taimei に届く時点 |
|---|---|---|
| SDK (`@taimei-code/auth-client`) | `package.json` で `1.1.0` に固定 | taimei が version を上げた時 |
| e2e の認証 server | `.github/workflows/e2e.yml` が taimei-auth の main を毎回 `git clone --depth 1` | taimei-auth の main に merge した瞬間 |

2 つ目の経路は固定されていない。taimei-auth の merge は、taimei の全 branch の e2e に即座に波及する。e2e が落ちた時、原因が taimei の変更か taimei-auth の変更かを、落ちた run だけでは切り分けられない。逆に taimei-auth 側は、自分の変更が taimei を壊すかを merge 前に知る手段を持たない。

taimei-auth#224 は、この状態で起きた不具合である。除名された user の `companyId` が、所属していない事業所を指したまま SDK から返っていた。taimei-auth の画面と API は補正で隠していたため、consumer 側でしか観測できなかった。

## Decision

e2e が使う taimei-auth を git submodule (`vendor/taimei-auth`) で commit に固定し、Dependabot の `gitsubmodule` ecosystem で週次に上げる。

- `docker-compose.e2e.yml` の `e2e-auth-service` の build context を `../taimei-auth` から `./vendor/taimei-auth` に変え、`e2e.yml` の clone step を `actions/checkout` の `submodules: true` に置き換える。
- `.github/dependabot.yml` に `package-ecosystem: "gitsubmodule"` を `interval: "weekly"` で足す。Dependabot の bump の PR は、taimei-auth の固定を上げる以外の変更を含まない。
- taimei-auth を上げて e2e が落ちたら、原因は bump の PR が示す commit 範囲 (taimei-auth の 2 つの SHA の間) にある。Dependabot の bump の PR では、taimei 側の変更と混ざらない。
- taimei の変更が taimei-auth の新しい server を要る時 (新しい RPC を使う SDK に上げる時など) は、同じ PR で固定も上げてよい (2026-10-15 改訂、#626)。その PR で e2e が落ちたら、原因は taimei 側の変更と taimei-auth の commit 範囲の両方にありうる。この切り分けの手間は、server と SDK を別の PR で上げる間、e2e が新しい経路を通らないことと引き換えに受け入れる。
- 本番の認証 server は固定しない (共有の service で、taimei-auth の main から deploy される)。本番との互換は、taimei-auth 側が「SDK の契約を後方互換に保ち、契約違反を自分の CI で止める」ことで守る (taimei-auth#225)。taimei の e2e が本番より最大 1 週間古い server で走ることは、この分担の上で受け入れる。

## Considered Options

- **main をそのまま clone する (現状)**: 上の Context のとおり、片方の変更がもう片方に即座に波及する。
- **workflow に SHA を直接書き、手で上げる**: 固定はできるが、追従が人の記憶に依存する。Dependabot の監視にも乗らない。
- **定期 workflow が SHA を更新する PR を作る**: `GITHUB_TOKEN` で作った PR は他の workflow を起動しないので、bump の PR で e2e が走らない。回避には PAT か GitHub App が要り、ADR-0001 が減らそうとした権限を増やす。
- **`auth-client-v*` の tag で固定する**: tag は SDK を publish する時にだけ付き、server だけの変更には付かない。固定しても server の変更を拾えない。
- **taimei-auth の CI で taimei の e2e を回す**: 依存の向きが逆になるだけで、2 つの repo の結合は残る。

## Consequences

- **前提条件**: Dependabot が起動した workflow には、Actions の secret ではなく Dependabot の secret が渡る。今の Dependabot PR の e2e は、`@taimei-code/auth-client` の取得が 401 で落ちている。`NPM_TOKEN` を Dependabot の secret にも登録しないと、bump の PR の e2e が走らない。登録すれば、既存の npm の Dependabot PR の e2e も通るようになる。
- local で e2e を回す前に `git submodule update --init` が要る。開発用の `docker-compose.yml` は sibling の taimei-auth を別に起動する今の形のままで、この ADR の対象外。
- taimei-auth の QA-MR-09 (「taimei は pin していない main を clone する」) の前提が変わる。この ADR を Accepted にする時に、taimei-auth 側の記述も直す。
