#!/usr/bin/env bash
# 配備先の最小確認（Issue #275）: health・トップ画面・未認証APIの401。
# 使い方: smoke-deployment.sh BASE_URL
# VERCEL_AUTOMATION_BYPASS_SECRET があれば保護された候補URLへbypass headerを付ける（値は出力しない）。
# 1要求は接続5秒・全体20秒、確認全体は約3分で必ず終わる。promote後のrollbackに時間を残すため（PR #276 review P2）。
set -euo pipefail

base="${1:?usage: smoke-deployment.sh BASE_URL}"
headers=()
if [[ -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then headers=(-H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"); fi
body="$(mktemp)"
trap 'rm -f "$body"' EXIT

probe() { # path expected_status
  local status attempt
  for attempt in 1 2 3 4 5; do
    status="$(curl -sS --connect-timeout 5 --max-time 20 -o "$body" -w '%{http_code}' "${headers[@]}" "$base$1" || true)"
    [[ "$status" == "$2" ]] && return 0
    sleep $((attempt * ${SMOKE_BACKOFF_SECONDS:-3})) # cold start・DB休止復帰を待つ
  done
  echo "NG $1: expected $2, got $status" >&2
  return 1
}

probe /api/health 200
grep -q '"status":"ok"' "$body" && grep -q '"database":"ok"' "$body" || { echo 'NG /api/health: status/database not ok' >&2; exit 1; }
echo 'OK /api/health 200 status=ok database=ok'
probe / 200
grep -qi '<title>Future ROI</title>' "$body" || { echo 'NG /: title not found' >&2; exit 1; }
echo 'OK / 200 Future ROI'
probe /api/goals 401
grep -q '"UNAUTHENTICATED"' "$body" || { echo 'NG /api/goals: not UNAUTHENTICATED' >&2; exit 1; }
echo 'OK /api/goals 401 UNAUTHENTICATED'
