#!/bin/bash
set -euo pipefail
export WORLD_URL="${WORLD_URL:-http://world:4747}"
export WORKSPACE="${WORKSPACE:-/app}"
cd "$WORKSPACE"
node /solution/reference-naive.mjs
