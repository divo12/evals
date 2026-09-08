#!/bin/bash
# Harbor verifier. Copied to /tests/test.sh and run after the agent.
# Always writes /logs/verifier/reward.txt.
set -uo pipefail
mkdir -p /logs/verifier
WORLD="${WORLD_URL:-http://world:4747}"
LEDGER=/tmp/ledger.jsonl
RUN_HANDLE=/app/trigger-run.json
WAIT_SECONDS="${VERIFIER_WAIT_SECONDS:-720}"

if ! curl -fsS -H "Authorization: Bearer ${VERIFIER_TOKEN:-}" "${WORLD}/internal/ledger" -o "$LEDGER"; then
  echo "infra: could not fetch ledger from ${WORLD}" | tee /logs/verifier/error.txt
  exit 2
fi

if [[ -f "$RUN_HANDLE" ]] && node -e '
  const fs = require("fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  process.exit(/^run_/.test(value.runId) && typeof value.taskId === "string" ? 0 : 1);
' "$RUN_HANDLE"; then
  deadline=$((SECONDS + WAIT_SECONDS))
  failures=0
  while ! grep -q '"kind":"run.finish"' "$LEDGER" && (( SECONDS < deadline )); do
    sleep 5
    if curl -fsS -H "Authorization: Bearer ${VERIFIER_TOKEN:-}" "${WORLD}/internal/ledger" -o "$LEDGER"; then
      failures=0
    else
      failures=$((failures + 1))
      if (( failures >= 3 )); then
        echo "infra: world ledger unavailable during verifier wait" | tee /logs/verifier/error.txt
        exit 2
      fi
    fi
  done
fi

node /tests/grade.mjs --ledger "$LEDGER" --oracle /tests/fixtures/oracle.json --require-trigger
