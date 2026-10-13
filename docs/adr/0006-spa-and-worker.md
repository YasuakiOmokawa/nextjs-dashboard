# ADR-0006: Next.js をやめ、Static Assets の SPA と Hono の Worker で配る

- **Status**: Accepted
- **Date**: 2026-10-10
- **References**: ADR-0005 (RLS と事業所スコープの transaction)

## Context

taimei は Next.js で Vercel に載り、DB は Neon の us-east-1 にある。taimei-auth は Cloudflare Workers (Free) で動き、DB は Neon ap-southeast-1 にある。taimei も Workers Free に載せたいが、Next.js のまま載せるとサーバーで React を描く分の CPU が Free の上限 10ms を超える (星取表のセル 300 個で +9.5ms と観測した)。

画面に SSR が要る読み手はいない。動的な画面はログインの後だけで、公開ページ (`/`・`/privacy`) は build 時に描けば足りる。

代わりに考えたもの:

- Next.js のまま Workers Paid にする: 比べる根拠を取っていない。Free で運用すると決めている
- TanStack Start: 主な価値は SSR と route ごとの prerender の切り替えで、taimei には要らない。server function の境界で Effect の型付きの失敗が途切れる
- API 層を Effect の `HttpApi` にする: SPA の API クライアントが gzip で約 115 KB 大きく、effect 4.0.0 では `@stability unstable`。taimei-auth は Hono を使う

## Decision

- 画面は Vite + React + TanStack Router の SPA (`web/`) にし、Workers の Static Assets で配る。画面の遷移では Worker を起動しない (`not_found_handling: "single-page-application"`)
- 追記 (2026-10-10、#579): ログインの入口とログイン後の戻り先 (`/auth`・`/auth/*`) は session を見て行き先を決める redirect なので Worker で返す。SPA で返すと JS が動くまで index.html (`/` の prerender) が見え、SPA が taimei-auth の URL を持つことになる。そのため `run_worker_first` を `["/api/*", "/auth", "/auth/*"]` にした。配列にすると `Sec-Fetch-Mode` での振り分けが止まり、ここに無い path は fetch でも Static Assets が返すので、`/api/*` も並べる
- 公開ページ (`/`・`/privacy`) は build 時に prerender する (`web/prerender.tsx`)。`/privacy` は `privacy.html` に書く (`privacy/index.html` だと `/privacy/` へ redirect する)
- API は Hono + Effect の Worker (`src/worker.ts`) にし、SPA は Hono の `hc` で呼ぶ (理由と見直す条件は ADR-0007)。DB は Hyperdrive 越しの Neon ap-southeast-1
- 追記 (2026-10-12、#602): 上の `hc` の行と Context の `HttpApi` の行は ADR-0007 で改めた。#603〜#605 で移した
- Next.js・`@sentry/nextjs`・Next の設定と画面は残さない。Next と Worker を並べて動かす期間も作らない
- 配置は taimei-auth に揃える (`src/` は Worker、`web/` は SPA、`db/` はそのまま)

## Consequences

- 画面はすべて SPA に作り直し、データは API の JSON で届く。応答に載せる項目はその人が見てよいものに絞る必要がある (Next の React Server Components では描画結果だけが届いた)
- Static Assets は `/` の prerender (`index.html`) を SPA の fallback にも返す。prerender していない path は、JS が描くまでランディングページが見える
- main は Next を持たなくなり、Vercel の build は落ちる。本番は Workers に切り替えるまで Vercel の直前の版のまま動き、その間 main は本番ではない
- 追記 (2026-10-12、#590): 本番を Workers に切り替え、`app.taimei-code.com` を Worker の custom domain で配る。main への push で `deploy.yml` が build・migration・deploy を流すので、main が本番になる。Vercel の project と旧 DB (us-east-1) は消す
- 手元と e2e は SPA を build して `wrangler dev` で配る。`wrangler dev` は `.env`・`.dev.vars` を読まない (`scripts/wrangler-dev.sh` が `--env-file` で渡す)
