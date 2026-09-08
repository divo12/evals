#!/bin/bash
set -uo pipefail
mkdir -p /logs/verifier
TRACKER="${TRACKER_URL:-http://tracker:9410}"
LEDGER=/tmp/ledger.jsonl

if ! curl -fsS -H "Authorization: Bearer ${VERIFIER_TOKEN:-}" "${TRACKER}/internal/ledger" -o "$LEDGER"; then
  echo "infra: could not fetch tracker ledger from ${TRACKER}" | tee /logs/verifier/error.txt
  exit 2
fi

if ! node /tests/verify-trigger-runs.mjs "$LEDGER" /tmp/trigger-runs.json 2> /logs/verifier/error.txt; then
  exit 2
fi

node /tests/grade.mjs --ledger "$LEDGER" --oracle /tests/fixtures/oracle.json --report /app/report.json --require-trigger --trigger-evidence /tmp/trigger-runs.json
