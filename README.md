# evals

Benchmarks for durable execution and long-running agents, built for Trigger.dev.
Design notes and the five scenarios: `docs/trigger-dev-eval-scenarios.html`.

## Tasks

| Task | Scenario | What it measures | Deps |
|---|---|---|---|
| `tasks/release-train/` | 5 (Claude workflow vs Claude + Trigger.dev) | Unattended multi-batch release: CI, delayed approvals, canaries, rollbacks, exactly-once deploys, timed follow-up, survival of SIGKILL / sleep | Node ≥ 20 |
| `tasks/ultracode-auth-audit/` | 5 (warm-up) | Fan-out audit with verifier agents, ticket side effects, flaky CI that outlasts the stall watchdog | Node ≥ 20 |

Each task follows the ITSMBench layout: `task.toml`, `instruction.md` (given to the agent),
`environment/` (the world + generator), `tests/` (verifier → `reward.txt`), `solution/`.
Grading is ledger-only: what the agent says it did is ignored; what hit the world counts.

## Quick start

```bash
cd tasks/release-train
./run.sh up smoke                 # terminal 1: world + generated workspace
cd workspace && claude            # terminal 2: paste ../instruction.md
../run.sh grade                   # after the run
```
