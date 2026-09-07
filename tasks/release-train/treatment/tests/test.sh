#!/bin/bash
# Harbor verifier. Copied to /tests/test.sh and run after the agent.
# Always writes /logs/verifier/reward.txt.
set -u
mkdir -p /logs/verifier
WORLD="${WORLD_URL:-http://world:4747}"
LEDGER=/tmp/ledger.jsonl

if ! curl -fsS -H "Authorization: Bearer ${VERIFIER_TOKEN:-}" "${WORLD}/internal/ledger" -o "$LEDGER"; then
  echo "infra: could not fetch ledger from ${WORLD}" | tee /logs/verifier/error.txt
  echo 0 > /logs/verifier/reward.txt
  exit 0
fi

node /tests/grade.mjs --ledger "$LEDGER" --oracle /tests/fixtures/oracle.json --require-trigger
exit 0
