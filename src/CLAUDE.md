# src

- API の route は `app.ts` に足す。`/api/*` の route は `requireSession` の後に登録し、cookie 無しの要求に 401 を返させる。session を見ない公開の route は `requireSession` より前に登録し、`__tests__/app.test.ts` の `PUBLIC_ENDPOINTS` に method と path を書く。Worker が受けるのは `wrangler.jsonc` の `run_worker_first` に当たる path だけで、外れた path は Static Assets が `index.html` を返す。どれも、`app.test.ts` の全ての route を列挙するテストが守らないと失敗する。
- handler は、実行口 (`src/services/index.ts`) の結果を `run-json.ts` の `resultJson` で、実行口を通さない値を `encodedJson` で返す。`resultJson` に実行口を通さない `Result` を渡すと型エラーになる。応答は schema に書いた項目だけを送る。入力は route の validator (`hono/validator`) で受け、handler は `c.req.valid` の値だけを使う。`c.req.<読み取り>` と `c.json(…)` は `biome-plugins/` の規則が lint のエラーにする。規則は書き方の形だけを見るので、`c.req` を別名で受け取る、`c.text` で返す、と書くと規則に当たらない。
- SPA (`web/src`) が import できるのは `app.ts` の型 (`import type`) だけで、それ以外を import すると `.fallowrc.json` の `boundaries` が lint のエラーにする。
