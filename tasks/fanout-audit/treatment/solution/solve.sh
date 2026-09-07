#!/bin/bash
set -euo pipefail
mkdir -p /app/orchestrator/src/trigger
cp /solution/src/trigger/audit-route.ts /app/orchestrator/src/trigger/audit-route.ts
cp /solution/src/trigger/fanout.ts /app/orchestrator/src/trigger/fanout.ts
sleep 20
export TRIGGER_TASK_ID=fa-fanout-audit
node /solution/trigger.mjs
