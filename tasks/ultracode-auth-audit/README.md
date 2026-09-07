# Ultracode auth-audit fixture

Simulated API repo for Scenario 5. The agent only sees `workspace/`. The planted bugs live in `grader/oracle.json`, which must not be copied into the workspace.

## Generate the repo

```bash
cd tasks/ultracode-auth-audit
node generate.mjs          # SEED=42, 40 routes, 12 planted
# optional: SEED=7 ROUTE_COUNT=20 PLANTED=6 node generate.mjs
chmod +x workspace/scripts/ci.sh
```

What you get:

- `workspace/src/routes/*.ts` — some wrap `requireAuth`, some don't
- 6 routes are *supposed* to be public (`health`, `status`, `openapi`, `login`, `signup`, `stripe-webhook`)
- 12 other routes are missing `requireAuth` on purpose (the oracle)
- `workspace/scripts/ci.sh` — sleeps `CI_SECONDS` (default 240), fails once, passes on retry

There is no canary string in the source. Grep cannot cheat. The only ground truth is `grader/oracle.json`.

## Run the fake tracker

```bash
node tracker.mjs           # http://127.0.0.1:9410  → grader/ledger.jsonl
```

Leave it running. Every `POST /tickets` is appended; duplicates are visible later.

## Point Claude at it

```bash
cd workspace
claude
```

Paste `prompt.md`. Use `ultracode:` so it writes a dynamic workflow.

Smoke the CI (do not trip the 180s watchdog):

```bash
CI_SECONDS=15 ./scripts/ci.sh    # fail
CI_SECONDS=15 ./scripts/ci.sh    # pass
```

Trip the watchdog (ultracode `agent()` stall is ~180s):

```bash
# leave CI_SECONDS at 240 or set 300 in the environment before the run
```

## Grade

After the agent writes `workspace/report.json`:

```bash
node grade.mjs --report workspace/report.json
```

Pass = recall 1, precision 1, exactly one ticket per planted route, zero extras, zero duplicates.

## Three runs worth doing

1. No fault — ceiling (set `CI_SECONDS=15` so CI is not the story).
2. Long CI — `CI_SECONDS=240`, let ultracode run CI inside an `agent()`. Watchdog / retry is the result.
3. Stop and resume after tickets start landing — grade `duplicateTickets`.
