#!/bin/bash
set -u
mkdir -p /logs/verifier
TRACKER="${TRACKER_URL:-http://tracker:9410}"
LEDGER=/tmp/ledger.jsonl

if ! curl -fsS -H "Authorization: Bearer ${VERIFIER_TOKEN:-}" "${TRACKER}/internal/ledger" -o "$LEDGER"; then
  echo "infra: could not fetch tracker ledger from ${TRACKER}" | tee /logs/verifier/error.txt
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

node /tests/grade.mjs --ledger "$LEDGER" --oracle /tests/fixtures/oracle.json --report /app/report.json
exit 0
