#!/bin/bash
set -euo pipefail
mkdir -p /app/orchestrator/src/trigger
cp /solution/src/trigger/train.ts /app/orchestrator/src/trigger/train.ts
cd /app/orchestrator
node trigger-once.mjs acme-release-train
