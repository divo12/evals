#!/bin/bash
set -euo pipefail
export TRACKER_URL="${TRACKER_URL:-http://tracker:9410}"
export WORKDIR="${WORKDIR:-/app}"
cd "$WORKDIR"
node /solution/solve.mjs
