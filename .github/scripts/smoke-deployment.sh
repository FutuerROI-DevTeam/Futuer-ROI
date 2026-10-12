#!/usr/bin/env bash
# 配備先の最小確認（Issue #275）: health・トップ画面・未認証APIの401。
# 使い方: smoke-deployment.sh BASE_URL
# VERCEL_AUTOMATION_BYPASS_SECRET があれば保護された候補URLへbypass headerを付ける（値は出力しない）。
set -euo pipefail

base="${1:?usage: smoke-deployment.sh BASE_URL}"
budget="${SMOKE_TIMEOUT_SECONDS:-120}"
[[ "$budget" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid smoke timeout' >&2; exit 2; }
deadline=$((SECONDS + budget))
headers=()
if [[ -n "${VERCEL_AUTOMATION_BYPASS_SECRET:-}" ]]; then headers=(-H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET"); fi
body="$(mktemp)"
trap 'rm -f "$body"' EXIT

probe() { # path expected_status
  local status attempt remaining request_timeout
  for attempt in 1 2 3 4 5; do
    remaining=$((deadline - SECONDS))
    if ((remaining <= 0)); then echo 'Smoke deadline exceeded' >&2; return 1; fi
    request_timeout=$((remaining < 15 ? remaining : 15))
    # A partial response can have HTTP 200 even when curl exits 28; require both.
    if status="$(curl --connect-timeout 5 --max-time "$request_timeout" -sS -o "$body" -w '%{http_code}' "${headers[@]}" "$base$1")"; then
      [[ "$status" == "$2" ]] && return 0
    fi
    remaining=$((deadline - SECONDS))
    ((attempt == 5 || remaining <= 0)) && break
    sleep "$((attempt * 3 < remaining ? attempt * 3 : remaining))" # cold start・DB休止復帰を待つ
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
