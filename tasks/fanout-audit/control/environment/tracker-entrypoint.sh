#!/bin/bash
# Generate the agent-visible repo onto the shared volume, then serve tickets.
# Lives on the tracker image so main cannot read the planted-set logic.
set -euo pipefail
mkdir -p /app
if [[ ! -f /app/src/app.ts ]]; then
  WORKSPACE=/app SEED="${SEED:-42}" ROUTE_COUNT="${ROUTE_COUNT:-16}" PLANTED="${PLANTED:-4}" \
    node /opt/generate.mjs
fi
exec node /opt/tracker.mjs
