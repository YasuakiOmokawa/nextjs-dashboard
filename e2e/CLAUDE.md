# e2e

E2E は認証など、壊れたら致命的な導線だけに書く。次の 2 つも致命的な導線に含める。

- 自分のレベルの保存 (製品の中心の書き込み) と、保存に失敗した時に保存できたように見せない表示
- チームの管理 (`GLOSSARY.md` の「チームの管理」の操作を管理者ができることと、メンバーの操作を API が拒むこと)

## 流し方

コマンドは `e2e/README.md`。README と違う点だけを書く。

- `NPM_TOKEN` は `$(/opt/homebrew/bin/gh auth token)` で渡す。ghtkn の token では `@taimei-code/auth-client` の取得が 403 になる
- build は ignore された `certs/*.pem` (社内 CA) を使うので、git worktree では `npm ci` が証明書のエラーで落ちる。e2e は pem のある main の tree で流す (worktree の変更は `git stash -u` で移す)
- `vendor/taimei-auth` を上げる時の PR の分け方は ADR-0003

## 手元で taimei と taimei-auth を配信する (/qa-ui)

`../taimei-auth` (`TAIMEI_AUTH_DIR` で変えられる) の checkout が要る。

- `bun run qa:serve` が DB を作って auth と taimei を起動し、OWNER の test user の email を出す。`--app-role` を付けると、taimei は本番の `taimei_app` と同じ RLS を通る role で接続する
- ログインは `http://localhost:3000/auth` から taimei-auth のフォームでその email に Magic Link を送り、`bun run qa:login` が出す file を開く (token は出力に出ず、file は 30 秒で消える)
- 定期処理 (`scheduled` の purge-departed) は `curl 'http://localhost:3000/cdn-cgi/handler/scheduled?cron=17+*+*+*+*'` で起こす。結果は `${TMPDIR:-/tmp}/taimei-qa/app.log` の `purge-departed` の行
- 終わったら `bun run qa:down` で server を止め、DB を消す
