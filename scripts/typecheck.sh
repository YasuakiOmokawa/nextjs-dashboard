#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# get-exe-path は非対応の TypeScript の版のエラーも stdout に出す
if ! tsc=$(effect-tsgo get-exe-path); then
  echo "$tsc" >&2
  exit 1
fi
"$tsc" --noEmit
"$tsc" --noEmit -p web
