# ADR-0008: チーム一覧を事業所ごとの Durable Object の SQLite に写し、一覧の読み取りで DB を読まない

- **Status**: Accepted
- **Date**: 2026-10-12
- **References**: ADR-0002 (事業所のデータに session 無しで触れない)、ADR-0005 (RLS)、#591

## Context

`GET /api/teams` (チーム一覧) は `/dashboard` を開くたびに最初に呼ぶ API で、いちばん多く呼ばれる。1 回ごとに Postgres の関数を 1 文流していた (Neon はシンガポール、Worker は東京で、1 文の往復は約 75〜90 ms)。#591 と、#591 が正本とする Workers 移行の Design Doc の T-16 は、事業所ごとの Durable Object に画面の値をメモリで置き、書き込みをすべて DO に通して 1 本ずつ並べ、書き込みの関数が返す版の番号で古い値の上書きを防ぐ形 (T-16 の原則 1・3、#591 の AC 2) を決めていた。

調べて分かったこと (2026-10-12、Cloudflare の文書):

- timer・未完の I/O・外への接続が無い DO は、10 秒の無活動で hibernate し、メモリの状態を捨てる。storage (SQLite) は hibernate と deploy をまたいで残る
- Workers Free は SQLite の storage の DO だけを作れる。stub の method の呼び出し 1 回が 1 要求 (1 日 100,000 まで)。行の書き込みは 1 日 100,000 行まで (削除も数える)
- `wrangler deploy` は毎回、新しい id の version を作る。Worker は binding `version_metadata` で自分の version の id を読める

メモリに置くと、寿命を何秒にしても 10 秒の hibernate で消える。事業所の全チームの星取表を置いて書き込みのたびに消す形も作ったが、一覧の画面は全チームの星取表を受け取って名前だけを使い、いちばん多い書き込み (メンバーのレベルの保存) のたびに cache が消えるので、当たる見込みが低かった (本番には出していない)。書き込みを DO に通して並べる形は、DO の中の明示の mutex と、書き込みの全 method の書き換えが要る。

## Decision

- 一覧に要る列 (チームの id・名前・並び順と、割り当てた人) だけを、事業所ごとの DO (`CompanyTeamListDurableObject`、名前は検証済みの session の事業所の id) の SQLite の表に写す。星取表とレベルは写さない
- 一覧の新しさは Postgres の表 `company_team_list_versions` の版で比べる。一覧を変える書き込みは `TeamManagement` (管理者) と `purgeDeparted` だけで、どちらも書き込みと同じ transaction の中で `bump_company_team_list` を呼び、版を増やして新しい一覧を読む。commit の後、応答の前に、その版で DO の表を書き直す。DO は、置いている版より小さい版では書き直さない。置いた Worker の version が違っても版は戻さない (deploy の間に、新しい Worker が少し前に読んだ古い版で、古い Worker が置いた新しい版を上書きしないため)書き込みを DO に通して並べる代わりに、版の行の lock が同じ事業所の書き込みを版の順に並べる
- `bump_company_team_list` は、版を増やす文と一覧を読む文を分ける。1 文にすると、前の書き込みの commit を待つ前の snapshot で一覧を読み、新しい版に古い一覧が付く
- `GET /api/teams` は DO の表を読み、見える範囲 (管理者か、割り当てがあるか) は要求ごとに Worker が判定する。DO が空、置いた Worker の version が違う (deploy の後)、置いてから 1 時間を過ぎた、のどれかの時だけ、`company_team_list` を 1 文読んで DO に置く
- メンバーのレベルの保存 (`runTeamService`) は DO を触らない
- 寿命 1 時間は安全網として持つ。commit の後、DO を書き直す前に Worker が止まると、書き込みの少ない事業所では次の管理者の書き込みまで古い一覧が残り続けるため。費用は事業所ごとに 1 時間に 1 回の DB の 1 文で、要らなければ定数を消せば、DB を読むのは DO が空の時と deploy の後だけになる
- 寿命が切れても同じ版なら、一覧の行を書き直さず寿命だけを延ばす。書き直しは「チームの数 × 2 + 2」行を書き、毎時の書き直しが Free 枠の行の書き込みを使い切りうるため
- 手作業の SQL の後に消す HTTP の口 (#591 の AC 4) は作らない。口を作ると、認証の付いた新しい入口 (秘密・CSRF・テスト) が要る。手作業の SQL は版を増やさないので、その後は GitHub Actions の Deploy を流し直し、Worker の version を変えて全事業所の一覧を DB から読み直させる。DB を backup から戻した後 (版が過去に戻る) も流し直す
- DO を呼べない時と 1 秒で返らない時は報告し、読み取りは Postgres の値で答え (DO に置きには行かない)、書き込みは結果を変えない。書き直しは 1 秒の中で 1 回だけ試し直し、届かなければ DO の表を消す。commit したか分からない (`DbUnavailable`) 時と、増やした版の一覧を読めない時も消す。DO の中の行が壊れて読めない時は、DO が自分で消す

## Consequences

- 管理者の書き込みは、transaction の中の 1 文と DO への 1 回の書き直しのぶん遅くなる。一覧を変えない `addSkill`・`removeSkill` も同じ費用を払う (実行口の単位で決めるので、書き分けの漏れが起きない)
- 次の場合に限り、最長 1 時間古い一覧が見えうる: 書き直しも消すのも届かなかった時、commit の後に Worker が止まった時、DO の storage が消えた直後に古い版の書き込みが届いた時。手作業の SQL と DB の復元の後は、Deploy を流し直すまで古い一覧が出る。チームの画面 (星取表) は毎回 DB が見える範囲を判定するので、外されたメンバーは開けない
- DB を backup から戻して Deploy を流し直した後は、DO の版が DB より大きい間、寿命が切れるまで毎回 DB を読む (古い一覧は出ない)
- 当たる割合と Free 枠の消費は本番で見る
