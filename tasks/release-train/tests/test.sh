#!/usr/bin/env bash
# ITSMBench-style verifier: reads the world ledger, writes tests/reward.txt (0 or 1) and tests/results.json.
set -euo pipefail
cd "$(dirname "$0")/.."
node tests/grade.mjs "$@" || true
echo "reward: $(cat tests/reward.txt)"
