#!/bin/bash
set -euo pipefail
mkdir -p /app /hidden
if [[ ! -f /app/RELEASE.md ]]; then
  WORKSPACE=/app ORACLE_OUT=/hidden/oracle.json node /opt/world/generate.mjs
fi
if [[ ! -f /hidden/oracle.json ]]; then
  WORKSPACE=/tmp/seed-ws ORACLE_OUT=/hidden/oracle.json node /opt/world/generate.mjs
fi
export WORKSPACE=/app
export ORACLE_PATH=/hidden/oracle.json
export LEDGER_PATH=/hidden/ledger.jsonl
exec node /opt/world/world.mjs
