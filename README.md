# evals

Harbor tasks for durable-agent and long-horizon coding evals (Trigger.dev Scenario 5).

Layout matches [ITSMBench](https://github.com/new-measure/ITSMBench) and the Harbor 0.22 task format, plus an eval-engineering `Task.md` (Draft) beside each package.

## Prerequisites

- [Harbor](https://github.com/laude-institute/harbor) 0.22 (`harbor --version`)
- Docker

## Tasks

| Task | What it measures | Harbor path |
|---|---|---|
| `tasks/release-train/` | Unattended gated release: CI, delayed approvals, canaries, rollbacks, exactly-once deploys, timed follow-up | `-p tasks/release-train` |
| `tasks/ultracode-auth-audit/` | Fan-out auth audit, tracker side effects, flaky CI | `-p tasks/ultracode-auth-audit` |

Each task has `instruction.md` (agent input), `environment/Dockerfile` + `docker-compose.yaml` (sidecar `world` or `tracker`), `tests/test.sh` (writes `/logs/verifier/reward.txt`), and `solution/solve.sh` (Oracle). Hidden oracles live in `tests/fixtures/` and are not copied into the `main` image.

## Run the reference path (Oracle)

```bash
harbor run -p tasks/ultracode-auth-audit -a oracle -e docker -n 1 -y
harbor run -p tasks/release-train -a oracle -e docker -n 1 -y
```

`release-train` defaults to `PROFILE=smoke` (~5–15 minutes). For the product comparison, set `PROFILE=compressed` and raise the agent timeout.

Jobs are written under `jobs/`.

Design notes: `docs/trigger-dev-eval-scenarios.html`.
Task specs are **Draft** (Harbor conversion requested end-to-end without a spec-approval pause).
