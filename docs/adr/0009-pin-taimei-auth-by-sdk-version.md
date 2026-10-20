# ADR-0009: e2e が使う taimei-auth を SDK の版で固定し、SDK に入った compose の断片で起動する

- **Status**: Accepted
- **Date**: 2026-10-20
- **Supersedes**: ADR-0003
- **References**: #631、#634、taimei-code/taimei-auth#285、taimei-auth の ADR-0020

## Context

ADR-0003 は e2e の taimei-auth を submodule `vendor/taimei-auth` の commit で固定した。taimei は taimei-auth の Dockerfile の target・migrate と起動の command・内部の環境変数の名前・auth の Postgres を `docker-compose.e2e.yml` に書き、taimei-auth が内部を変えると taimei の e2e が落ちた。版の固定も root の SDK と submodule の 2 か所に分かれ、SDK と server を別の PR で上げる間、e2e は新しい経路を通らなかった。

taimei-auth は SDK 3.6.0 から、試験用の image を SDK と同じ版で GHCR に private で出し、その digest を埋めた compose の断片 `testing/compose.yml` を SDK の package に入れている。

## Decision

- e2e は root の `node_modules` にある SDK の断片を `docker-compose.e2e.yml` の `include:` で読み、taimei-auth に渡すのは `e2e/taimei-auth.env` の `TAIMEI_AUTH_*` だけにする
- taimei-auth の成果物の版を固定するのは root の `package.json` の `@taimei-code/auth-client` の 1 か所にする。上げるのは Dependabot の `bun` の SDK の PR で、submodule と Dependabot の `gitsubmodule` は消す
- e2e の container は root の SDK を read-only で mount する。e2e の package に SDK を足さない
- CI は compose の前に root で `bun install` し、`docker login ghcr.io` する。どちらも既存の `NPM_TOKEN` (`read:packages`) を使う

ADR-0003 は「`auth-client-v*` の tag で固定する」を、server だけの変更を拾えないとして棄却した。この ADR はその棄却を撤回する。taimei-auth の server だけの merge は、次の SDK の release まで taimei の e2e に届かない。代わりに、SDK と試験用の image が同じ版で出るので、e2e が SDK と違う版の server と走ることは起きない。

## Considered Options

- **submodule の断片を `include:` する**: 版の固定が SDK と submodule の 2 か所に残る。
- **e2e を root の workspace に入れて mount をやめる**: lockfile と `node_modules` を共有し、app の image に試験用の package が入る。

## Consequences

- 前提条件 (ADR-0003 から引き継ぐ、未了): Dependabot の secret に `NPM_TOKEN` を登録する。SDK の bump の PR が taimei-auth を上げる唯一の経路になり、登録が無いとその PR の e2e は `bun install` と `docker login` で落ちる。
- local で e2e を回す前に、root の `bun install` と GHCR への login が要る (手順は `e2e/README.md` の「前提」)。
- 断片の DB は run のたびに空になる。
