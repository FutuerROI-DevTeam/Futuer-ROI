#!/usr/bin/env bash
# 本番の直結DB URL（DATABASE_URL_UNPOOLED）をVercelから実行中だけ取得し、DATABASE_URLとして1コマンドへ渡す（Issue #275）。
# 値はmaskしてから扱い、一時ファイルは取得直後に消す。stdout/stderrへ接続値を出さない。
# 必要な環境変数: VERCEL_TOKEN VERCEL_ORG_ID VERCEL_PROJECT_ID RUNNER_TEMP
set -euo pipefail

if [[ $# -eq 0 ]]; then echo 'usage: with-production-db.sh COMMAND [ARGS...]' >&2; exit 2; fi
env_file="$(mktemp "${RUNNER_TEMP:?}/production-env.XXXXXX")"
trap 'rm -f "$env_file"' EXIT

npx --yes vercel@63.1.2 env pull "$env_file" --environment=production --yes --token "$VERCEL_TOKEN" >/dev/null 2>&1 \
  || { echo 'Vercelから本番の環境変数を取得できませんでした。' >&2; exit 1; }
url="$(sed -n 's/^DATABASE_URL_UNPOOLED="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$env_file" | head -n 1)"
rm -f "$env_file"
if [[ -z "$url" ]]; then echo 'DATABASE_URL_UNPOOLED を取得できませんでした。' >&2; exit 1; fi
echo "::add-mask::$url"

DATABASE_URL="$url" "$@"
