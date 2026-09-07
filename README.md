# evals

Harbor tasks for durable-agent and long-horizon coding evals (Trigger.dev Scenario 5).

Layout matches [ITSMBench](https://github.com/new-measure/ITSMBench) and the Harbor 0.22 task format. `tasks/release-train/Task.md` covers both arms; Harbor packages live in `control/` and `treatment/`.

## Prerequisites

- [Harbor](https://github.com/laude-institute/harbor) 0.22 (`harbor --version`)
- Docker

## Tasks

| Task | What it measures | Harbor path |
|---|---|---|
| `tasks/release-train/control/` | Control: session-bound gated release | `-p tasks/release-train/control` |
| `tasks/release-train/treatment/` | Treatment: same train, written as Trigger.dev | `-p tasks/release-train/treatment` |
| `tasks/ultracode-auth-audit/` | Fan-out auth audit, tracker side effects, flaky CI | `-p tasks/ultracode-auth-audit` |

Each Harbor package has `instruction.md`, `environment/`, and `tests/test.sh` (writes `/logs/verifier/reward.txt`). Control has `solution/solve.sh` (Oracle). Hidden oracles live in `tests/fixtures/` and are not copied into the `main` image.

## Run the reference path (Oracle)

```bash
harbor run -p tasks/ultracode-auth-audit -a oracle -e docker -n 1 -y
harbor run -p tasks/release-train/control -a oracle -e docker -n 1 -y
# treatment needs cloud keys; no Oracle solution yet
# harbor run -p tasks/release-train/treatment --env-file .env -e docker -n 1 -y
```

`release-train` defaults to `PROFILE=smoke` (~5–15 minutes). For the product comparison, set `PROFILE=compressed` and raise the agent timeout.

Jobs are written under `jobs/`.

Design notes: `docs/trigger-dev-eval-scenarios.html`.
Task specs are **Draft** (Harbor conversion requested end-to-end without a spec-approval pause).
