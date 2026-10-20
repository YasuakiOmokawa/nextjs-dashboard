# e2e

E2E は認証など、壊れたら致命的な導線だけに書く。次の 2 つも致命的な導線に含める。

- 自分のレベルの保存 (製品の中心の書き込み) と、保存に失敗した時に保存できたように見せない表示
- チームの管理 (`GLOSSARY.md` の「チームの管理」の操作を管理者ができることと、メンバーの操作を API が拒むこと)

## 流し方

コマンドは `e2e/README.md`。README と違う点だけを書く。

- `NPM_TOKEN` は `$(/opt/homebrew/bin/gh auth token)` で渡す。ghtkn の token では `@taimei-code/auth-client` の取得が 403 になる
- build は ignore された `certs/*.pem` (社内 CA) を使うので、git worktree では `npm ci` が証明書のエラーで落ちる。e2e は pem のある main の tree で流す (worktree の変更は `git stash -u` で移す)
- taimei-auth の版は root の SDK の版で固定する (ADR-0009)

## 手元で taimei と taimei-auth を配信する (/qa-ui)

e2e と同じく、root の `bun install` と `docker login ghcr.io` を済ませておく (手順は `e2e/README.md` の「前提」)。

- `bun run qa:serve` が taimei の DB を作り、SDK の compose の断片で auth を、host で taimei を起動する。`--app-role` を付けると、taimei は本番の `taimei_app` と同じ RLS を通る role で接続する
- ログインは `bun run qa:login` が出す file を開く (ログイン URL は出力に出ず、file は 30 秒で消える)。`qa:login` は呼ぶたびに新しい OWNER の利用者と事業所を作るので、ログインし直すと前の事業所のデータは見えない
- 定期処理 (`scheduled` の purge-departed) は `curl 'http://localhost:3000/cdn-cgi/handler/scheduled?cron=17+*+*+*+*'` で起こす。結果は `${TMPDIR:-/tmp}/taimei-qa/app.log` の `purge-departed` の行
- 終わったら `bun run qa:down` で server を止め、DB を消す
