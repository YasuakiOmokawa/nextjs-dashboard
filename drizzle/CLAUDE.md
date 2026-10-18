# drizzle

- main に push すると、`.github/workflows/deploy.yml` が deploy の前に承認なしで本番に適用する。
- 生成は `db/drizzle/schema.ts` を変えて `bunx drizzle-kit generate --name <slug>`。生成物を読み、意図しない DROP・CASCADE が無いことを確かめる (文の順と CASCADE は手で直してよい。前例は 0002・0006・0008)。
- schema で表せない SQL (関数など) は `bunx drizzle-kit generate --custom --name <slug>` で空の migration を作って書く (0010)。
- migrate は失敗してもエラー文を出さない。同じ SQL を `docker compose exec -T test_db psql -U postgres -d taimei_test` で `BEGIN; … ROLLBACK;` して原因を見る。migration を作り直したら `docker compose rm -sf test_db` で test_db を空にする (古い版が残ると vitest の global setup が落ちる)。
