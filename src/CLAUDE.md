# src

- SPA が呼ぶ API は、`spa-contract.ts` の契約に endpoint を足し、`spa-http-api.ts` の `handlers` に handler を書く。payload の schema には JSON の形と要求の大きさの上限 (配列の件数など) だけを書き、値の意味 (id の形・レベルの範囲) は Service が decode して tagged error にする。
- session を見ない公開の route は `app.ts` の Hono に足す。
- 画面 `/dashboard/<page>` が最初に呼ぶ API は `/api/<page>` に置く (`/dashboard` は `/api/teams`)。`web/index.html` がこの対応で、JS を待たずに画面の API を呼び始める。
