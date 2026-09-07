#!/bin/bash
set -euo pipefail
mkdir -p /app/orchestrator/src/trigger
cp /solution/src/trigger/train.ts /app/orchestrator/src/trigger/train.ts
# Sidecar watcher rebuilds; Cloud can list the task before the local executor exists.
sleep 20
export TRIGGER_TASK_ID=acme-release-train
node /solution/trigger.mjs
