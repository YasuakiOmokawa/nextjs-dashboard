# Taimei

## 前提

- 開発環境と e2e は、root での `bun install` と `docker login ghcr.io` が要る (手順は `e2e/README.md` の「前提」)。root の `docker compose` は `bun install` が入れる SDK の compose の断片を読むので、`bun run test:db` も `bun install` の後に動く
- `/etc/hosts` に `127.0.0.1 app.taimei-code.local auth.taimei-code.local`
- `.env` に `NPM_TOKEN=<read:packages 権限の GitHub PAT>` (`@taimei-code/auth-client` の取得用)
- port 3001 / 3100 / 5433 / 5434 が空いていること

## 開発環境

```console
docker compose up --build --watch
```

taimei と taimei の DB に加え、SDK の compose の断片で taimei-auth と auth の DB が起動する。ログインは `bun run dev:login` が出す file を 30 秒以内に開く。`dev:login` は呼ぶたびに新しい OWNER の利用者と事業所を作る。auth の DB は起動のたびに空になり、taimei の DB は残るので、前の起動で作った事業所のデータは見えなくなる。

taimei は SPA (`web/`) を `bun run build` で build し、Worker (`src/worker.ts`) と一緒に `bun run start` (`wrangler dev`) で配る。`wrangler dev` は `.env`・`.dev.vars` を読まず、`APP_`・`AUTH_` で始まる環境変数だけを Worker に渡す (`scripts/wrangler-dev.sh`)。画面だけを直すときは `bun run dev` (vite の dev server) で見る。

## E2E

流し方は `e2e/README.md`。

## 型チェック

`bun run typecheck` を使う (TypeScript 7。root と `web/` の tsconfig を両方検査する)。Effect の書き間違い (`yield*` の無い Effect など) も、`@effect/tsgo` に同梱の Effect の診断入りの `tsc` が型エラーにする。診断の重さは `tsconfig.json` の `plugins` で決める。

`@effect/tsgo` は対応する `typescript` の版を狭く決めていて、合わない版では `bun run typecheck` が `UnsupportedTargetPackageVersionError` で止まる。`typescript` は、`node_modules/@effect/tsgo/README.md` の Supported Package Versions に載る版へ、`@effect/tsgo` と一緒に上げる。
