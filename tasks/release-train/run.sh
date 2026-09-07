#!/usr/bin/env bash
# Operator helper.
#   ./run.sh up [smoke|compressed|real]   generate workspace, start the world (foreground)
#   ./run.sh reset                         wipe workspace + ledger
#   ./run.sh grade                         run the verifier
#   ./run.sh fault <type> [note]           record an injected fault in the ledger (do this when you kill/sleep things)
set -euo pipefail
cd "$(dirname "$0")"
cmd="${1:-up}"
case "$cmd" in
  up)
    node environment/generate.mjs
    PROFILE="${2:-smoke}" exec node environment/world.mjs
    ;;
  reset)
    rm -rf workspace environment/ledger.jsonl environment/oracle.json tests/results.json tests/reward.txt
    echo "reset"
    ;;
  grade)
    bash tests/test.sh
    ;;
  fault)
    curl -s -X POST "${WORLD_URL:-http://127.0.0.1:4747}/fault" -H 'content-type: application/json' \
      -d "{\"type\":\"${2:-unknown}\",\"note\":\"${3:-}\"}" && echo
    ;;
  *)
    echo "usage: ./run.sh up|reset|grade|fault"; exit 1
    ;;
esac
