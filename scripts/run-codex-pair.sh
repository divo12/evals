#!/usr/bin/env bash
set -euo pipefail

task_family="${1:-}"
env_file="${2:-.env}"
case "$task_family" in
  fanout-audit|release-train) ;;
  *) echo "usage: $0 <fanout-audit|release-train> [env-file]" >&2; exit 2 ;;
esac

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
skill_root="${CODEX_DYNAMIC_WORKFLOW_SKILL:-${CODEX_HOME:-$HOME/.codex}/skills/codex-dynamic-workflows}"
trigger_skill="$repo_root/tasks/release-train/treatment/skills/trigger-authoring-tasks"
if [[ ! -f "$skill_root/SKILL.md" ]]; then
  echo "missing codex-dynamic-workflows skill at $skill_root" >&2
  exit 2
fi
if [[ ! -f "$env_file" ]]; then
  echo "missing treatment env file: $env_file" >&2
  exit 2
fi
if [[ "$task_family" == "release-train" && ! -f "$trigger_skill/SKILL.md" ]]; then
  echo "missing Trigger.dev treatment skill at $trigger_skill" >&2
  exit 2
fi

pair_id="$(date -u +%Y%m%dT%H%M%SZ)"
export CODEX_FORCE_AUTH_JSON=1
common=(-a codex -m gpt-5.6-sol --ak reasoning_effort=high -e docker -n 1 -y)
treatment_extra=()
if [[ "$task_family" == "release-train" ]]; then
  treatment_extra=(--skill "$trigger_skill")
fi

cd "$repo_root"
harbor run -p "tasks/$task_family/control" "${common[@]}" \
  --skill "$skill_root" \
  --job-name "codex-${task_family}-control-${pair_id}"

harbor run -p "tasks/$task_family/treatment" "${common[@]}" \
  --env-file "$env_file" \
  "${treatment_extra[@]}" \
  --job-name "codex-${task_family}-treatment-${pair_id}"
