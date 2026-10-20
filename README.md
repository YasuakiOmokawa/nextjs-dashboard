# Taimei

## 前提

- 親ディレクトリに `taimei-auth` を clone (開発環境用)
- e2e は、root での `bun install` と `docker login ghcr.io` が要る (手順は `e2e/README.md` の「前提」)
- `/etc/hosts` に `127.0.0.1 app.taimei-code.local auth.taimei-code.local`
- `.env` に `NPM_TOKEN=<read:packages 権限の GitHub PAT>` (`@taimei-code/auth-client` の取得用)
- port 3001 / 3100 / 5433 / 5434 / 5435 が空いていること

## 開発環境

taimei-auth が共有ネットワーク `taimei-network` を作るため、taimei-auth → taimei の順に起動し、逆順に停止する。

```console
cd ../taimei-auth && docker compose up --build --watch
docker compose up --build --watch   # 別ターミナルで taimei 側
```

`http://app.taimei-code.local:3001` を開く。Magic Link は `docker logs taimei-auth-auth-service-1 | grep "Magic Link"` で取得する。

taimei は SPA (`web/`) を `bun run build` で build し、Worker (`src/worker.ts`) と一緒に `bun run start` (`wrangler dev`) で配る。`wrangler dev` は `.env`・`.dev.vars` を読まず、`APP_`・`AUTH_` で始まる環境変数だけを Worker に渡す (`scripts/wrangler-dev.sh`)。画面だけを直すときは `bun run dev` (vite の dev server) で見る。

## E2E

流し方は `e2e/README.md`。

## 型チェック

`bun run typecheck` を使う (TypeScript 7。root と `web/` の tsconfig を両方検査する)。Effect の書き間違い (`yield*` の無い Effect など) も、`@effect/tsgo` に同梱の Effect の診断入りの `tsc` が型エラーにする。診断の重さは `tsconfig.json` の `plugins` で決める。

`@effect/tsgo` は対応する `typescript` の版を狭く決めていて、合わない版では `bun run typecheck` が `UnsupportedTargetPackageVersionError` で止まる。`typescript` は、`node_modules/@effect/tsgo/README.md` の Supported Package Versions に載る版へ、`@effect/tsgo` と一緒に上げる。
