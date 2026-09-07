#!/bin/bash
set -euo pipefail
mkdir -p /app/orchestrator/src/trigger
cp /solution/src/trigger/sonnet.ts /app/orchestrator/src/trigger/sonnet.ts
cp /solution/src/trigger/audit-route.ts /app/orchestrator/src/trigger/audit-route.ts
cp /solution/src/trigger/fanout.ts /app/orchestrator/src/trigger/fanout.ts
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  export ANTHROPIC_API_KEY="$CLAUDE_CODE_OAUTH_TOKEN"
fi
sleep 20
export TRIGGER_TASK_ID=fa-fanout-audit
node /solution/trigger.mjs
