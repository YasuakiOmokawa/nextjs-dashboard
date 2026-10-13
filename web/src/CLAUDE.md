# web/src

- 画面のデータは `web/src/api.ts` の atom と hook だけで読み書きする。読み取りは route の loader が `loadAtom` で待ち、画面が `useLoadedValue` で値を、`errorComponent` が `useLoadFailure` で失敗を読む。書き込みは `api.ts` に更新の定義 (`apiMutation` に送る処理と成功の後の処理 `afterSuccess`) を足し、画面は `useApiMutation` で流す。
- 一覧を変える書き込みは `afterSuccess` で一覧に古くした印を付け (`markStale`)、次に一覧を開く loader に取り直しを待たせる。チームを消す書き込みは、消したチームにも印を付ける。表示中のチームを変える書き込みはチームを取り直して待つ。
