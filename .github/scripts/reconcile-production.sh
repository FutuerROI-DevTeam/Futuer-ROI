#!/usr/bin/env bash
# promoteを試みた後に、本番URLが実際に指すdeploymentを照合して確認・復旧する（Issue #275、PR #276 review P1）。
# Vercelの --timeout はCLIの待機を止めるだけで、受理されたpromotionは後から完了し得るため、CLIの成否ではなく実aliasで判断する。
# 使い方: reconcile-production.sh CANDIDATE_ID PREVIOUS_ID
# 必要な環境変数: VERCEL_TOKEN VERCEL_ORG_ID PRODUCTION_URL TARGET_SHA RUNNER_TEMP
# 終了code: 0 = 候補が本番で確認成功 / 1 = 直前の版へ戻した（または戻せなかった）
set -uo pipefail

candidate="${1:?candidate id}"
previous="${2:?previous id}"
here="$(dirname "$0")"
host="${PRODUCTION_URL#https://}"
current="$RUNNER_TEMP/reconcile-production.json"

production_id() {
  curl -fsS --connect-timeout 5 --max-time 20 -H "Authorization: Bearer $VERCEL_TOKEN" \
    "https://api.vercel.com/v13/deployments/$host?teamId=$VERCEL_ORG_ID" > "$current" || return 1
  node -e "console.log(require(process.argv[1]).id ?? '')" "$current"
}

# 受理済みのpromotionが反映されるまで最大4分待つ。候補になった時点で待機を終える。
state=unknown
deadline=$((SECONDS + ${RECONCILE_WAIT_SECONDS:-240}))
while :; do
  id="$(production_id || true)"
  state="$(node "$here/deploy-gate.mjs" state "$id" "$candidate" "$previous" | sed -n 's/^state=//p')"
  [[ "$state" == candidate || $SECONDS -ge $deadline ]] && break
  sleep "${RECONCILE_POLL_SECONDS:-10}"
done
echo "production state: $state"

smoke_ok=false
if [[ "$state" == candidate ]] \
  && node "$here/deploy-gate.mjs" deployment "$current" >/dev/null \
  && bash "$here/smoke-deployment.sh" "$PRODUCTION_URL"; then
  smoke_ok=true
fi

action="$(node "$here/deploy-gate.mjs" recovery "$state" "$smoke_ok" | sed -n 's/^action=//p')"
if [[ "$action" == done ]]; then
  echo "- 本番: \`$TARGET_SHA\` を確認（health・/・401）" >> "$GITHUB_STEP_SUMMARY"
  exit 0
fi

# 候補が本番になった・後から本番になり得る・状態不明のいずれでも、直前の版を明示的に本番へ固定し直す。
echo "直前の版 $previous へ戻します（DBは戻しません）。"
npx --yes vercel@63.1.2 rollback "$previous" --yes --timeout 3m --token "$VERCEL_TOKEN" || true
restored="$(production_id || true)"
if [[ "$restored" == "$previous" ]]; then
  echo "- 本番確認に失敗（state=$state）。直前の版 \`$previous\` へ戻したことを確認しました。DBは戻していません。" >> "$GITHUB_STEP_SUMMARY"
else
  echo "- **本番確認に失敗し、直前の版へ戻ったことも確認できません**（現在 \`${restored:-unknown}\`）。release-guide 11-B で手動対応してください。" >> "$GITHUB_STEP_SUMMARY"
fi
exit 1
