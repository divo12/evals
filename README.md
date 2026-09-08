# evals

Harbor tasks for durable-agent and long-horizon coding evals (Trigger.dev Scenario 5).

Latest comparison: [`results/release-train.md`](results/release-train.md).

Layout matches [ITSMBench](https://github.com/new-measure/ITSMBench) and the Harbor 0.22 task format. Each family (`release-train`, `fanout-audit`) keeps human `Task.md` / `README.md` at the family root; Harbor packages live in `control/` and `treatment/`.

## Prerequisites

- [Harbor](https://github.com/laude-institute/harbor) 0.22 (`harbor --version`)
- Docker

## Tasks

| Task | What it measures | Harbor path |
|---|---|---|
| `tasks/release-train/control/` | Control: Codex dynamic-workflow skill + native subagents | `-p tasks/release-train/control` |
| `tasks/release-train/treatment/` | Treatment: the same Codex authors Trigger.dev | `-p tasks/release-train/treatment` |
| `tasks/fanout-audit/control/` | Control: Codex dynamic-workflow skill + native subagents | `-p tasks/fanout-audit/control` |
| `tasks/fanout-audit/treatment/` | Treatment: the same Codex authors Trigger.dev + model children | `-p tasks/fanout-audit/treatment` |

Each Harbor package has `instruction.md`, `environment/`, and `tests/test.sh` (writes `/logs/verifier/reward.txt`). Control has `solution/solve.sh` (Oracle). Hidden oracles live in `tests/fixtures/` and are not copied into the `main` image.

## Run the reference path (Oracle)

```bash
harbor run -p tasks/release-train/control -a oracle -e docker -n 1 -y
harbor run -p tasks/release-train/treatment -a oracle --env-file .env -e docker -n 1 -y
harbor run -p tasks/fanout-audit/control -a oracle -e docker -n 1 -y
# fanout-audit treatment Oracle needs Trigger and OpenAI vars in .env
```

`release-train` defaults to `PROFILE=smoke` (~5–15 minutes). For the product comparison, set `PROFILE=compressed` and raise the agent timeout.

Paired model runs use Codex `gpt-5.6-sol` with high reasoning in both arms.
Control receives `codex-dynamic-workflows`; treatment receives the Trigger.dev
environment and no control skill. Release treatment receives Trigger.dev's
official `trigger-authoring-tasks` skill, installed from the pinned 4.5.16 CLI.
The installed control skill is pinned to
upstream revision `ae9af55a3ad9ee396d6edcc9177c6f83638e73f4`. Treat missing
control skill/subagent use, a model or reasoning mismatch, or missing Trigger
Run API evidence as an invalid arm assignment rather than a model failure.

Run one paired trial:

```bash
scripts/run-codex-pair.sh release-train .env
```

The runner exports `CODEX_FORCE_AUTH_JSON=1` in Harbor's host process so Harbor
forwards the host Codex ChatGPT login into each disposable agent container. It
is deliberately not passed with `--agent-env`, because Harbor would redact its
one-character value from retained artifacts. No OpenAI API key is needed for
the release-train pair.

These packages are no-fault baselines. They measure authoring and successful
execution in `trigger dev`; they do not establish production deployment or
crash-recovery durability.

Release treatment is fire-and-exit: Codex writes one Trigger run handle and
ends. Its verifier waits for the asynchronous workflow, so Codex tokens are not
spent monitoring Trigger execution.

Deterministic verifier checks:

```bash
node tasks/fanout-audit/check-grader.mjs
node tasks/release-train/check-protected-ci.mjs
```

Harbor reports only one Codex rollout when an arm spawns subagents. Sum every
parent/subagent session before comparing cost:

```bash
node scripts/summarize-codex-job.mjs jobs/<job-name>
```

The estimator records GPT-5.6 Sol's 2026-09-08 standard rates; recheck the
[official API pricing](https://developers.openai.com/api/docs/pricing) before a
later study.

Jobs are written under `jobs/`.

Design notes: `docs/trigger-dev-eval-scenarios.html`.
Task specs remain **Draft** pending review of the audit-driven scoring and
environment changes.
