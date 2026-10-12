#!/usr/bin/env bash
# reconcile-production.sh の回帰（Issue #275、PR #276 review P1）。curl・npxをstubに置き換え、外部へ接続しない。
# 1) promotionが遅れて完了しても候補を確認して完了 2) 候補の確認失敗でrollback 3) 切り替わらなければ直前の版を固定し直す
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin"
SHA="$(printf 'a%.0s' {1..40})"

cat > "$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
# Vercel APIは STUB_DIR/sequence の先頭のdeployment idを返し、最後の1件は残す。それ以外のURLはsmoke用の応答。
out=''; url=''; write=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) write="$2"; shift 2 ;;
    -H|--connect-timeout|--max-time) shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
if [[ "$url" == https://api.vercel.com/* ]]; then
  read -r id rest < "$STUB_DIR/sequence"
  [[ -n "${rest:-}" ]] && echo "$rest" > "$STUB_DIR/sequence"
  meta='{}'; [[ "$id" == dpl_new ]] && meta="{\"cdSha\":\"$TARGET_SHA\"}"
  echo "{\"id\":\"$id\",\"readyState\":\"READY\",\"target\":\"production\",\"meta\":$meta}"
  exit 0
fi
path="/${url#https://*/}"; [[ "$url" == "https://future-roi.test" ]] && path=/
status=200; body=''
case "$path" in
  /api/health) body='{"status":"ok","database":"ok"}'; [[ "$STUB_SMOKE" == fail ]] && status=503 ;;
  /) body='<title>Future ROI</title>' ;;
  /api/goals) status=401; body='{"error":{"code":"UNAUTHENTICATED"}}' ;;
esac
[[ -n "$out" ]] && printf '%s' "$body" > "$out"
[[ -n "$write" ]] && printf '%s' "$status"
exit 0
STUB

cat > "$work/bin/npx" <<'STUB'
#!/usr/bin/env bash
# vercel rollback ID を記録し、以後の本番をそのIDにする。
args=" $* "
if [[ "$args" == *" rollback "* ]]; then
  id="$(sed -n 's/.* rollback \([^ ]*\) .*/\1/p' <<< "$args")"
  echo "$id" >> "$STUB_DIR/rollbacks"
  echo "$id" > "$STUB_DIR/sequence"
fi
exit 0
STUB
chmod +x "$work/bin/curl" "$work/bin/npx"

run_case() { # name sequence smoke expected_exit expected_rollbacks
  local dir="$work/$1"; mkdir -p "$dir"; echo "$2" > "$dir/sequence"; : > "$dir/rollbacks"
  local code=0
  STUB_DIR="$dir" STUB_SMOKE="$3" PATH="$work/bin:$PATH" TARGET_SHA="$SHA" VERCEL_TOKEN=t VERCEL_ORG_ID=o \
    PRODUCTION_URL=https://future-roi.test RUNNER_TEMP="$dir" GITHUB_STEP_SUMMARY="$dir/summary" \
    RECONCILE_WAIT_SECONDS=15 RECONCILE_POLL_SECONDS=0 SMOKE_BACKOFF_SECONDS=0 \
    bash "$here/reconcile-production.sh" dpl_new dpl_old > "$dir/log" 2>&1 || code=$?
  local rollbacks; rollbacks="$(tr '\n' ' ' < "$dir/rollbacks" | sed 's/ $//')"
  if [[ "$code" != "$4" || "$rollbacks" != "$5" ]]; then
    echo "NG $1: exit=$code rollbacks='$rollbacks'"; cat "$dir/log"; exit 1
  fi
  echo "OK $1"
}

run_case late-promotion-succeeds 'dpl_old dpl_old dpl_new' ok 0 ''
run_case candidate-fails-smoke 'dpl_new' fail 1 'dpl_old'
run_case never-switches 'dpl_old' ok 1 'dpl_old'
run_case unknown-production 'dpl_other' ok 1 'dpl_old'
