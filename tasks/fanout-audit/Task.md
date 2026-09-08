# Task: fanout-audit

**Status:** Draft

<!--
Human control-plane spec for both arms. Lives at the family root so it is not
inside a Harbor build context. Do not copy or mount it into either agent image.
-->

Two Harbor packages, one tracker, one planted set:

| Arm | Harbor path | Instruction |
|---|---|---|
| Control | `tasks/fanout-audit/control` | `control/instruction.md` |
| Treatment | `tasks/fanout-audit/treatment` | `treatment/instruction.md` |

## Purpose and evidence

- Work the agent must accomplish: audit every route under `src/routes/` for missing `requireAuth`, independently confirm each finding, file one tracker ticket per confirmed route, retry flaky CI, write `report.json`.
- Capability being tested:
  - Control: Claude Code writes and runs a native `Workflow` fan-out. The session is the runtime.
  - Treatment: Claude writes a Trigger.dev parent that `batchTriggerAndWait`s Claude child tasks. Each child calls the same model release used by the control arm.
- Why this case matters: Scenario 5 agent/subagent comparison. Same files and grader; only the substrate changes. `release-train` already covers long waits.
- Repository, trace, existing Task, or human evidence: recovered generator/tracker/grader from the retired `ultracode-auth-audit` package (`42fbc07`); Claude workflow docs (`agent` + `pipeline`); Trigger `batchTriggerAndWait` + child model calls.
- Difference from existing Tasks: fan-out of LLM workers, not timed canaries. Family layout matches `tasks/release-train`.

## Agent input

- Exact initial instruction: `control/instruction.md` or `treatment/instruction.md`.
- Later user turns or event input, if any: none.
- Context supplied outside the instruction:
  - Both: generated `/app` API repo; `TRACKER_URL=http://tracker:9410`; `CI_SECONDS`.
  - Treatment only: seeded `/app/orchestrator`; Trigger keys in `main`; `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` on the worker only.

## Relevant agent conditions

- Both arms use the same resolved Claude author model, ultracode effort, tool configuration, and authoring budget.
- Control: use the native `Workflow` tool and stay in `main` until CI is green. A retained trajectory without a `Workflow` call is an invalid arm assignment.
- Treatment: author parent `fa-fanout-audit` plus child `fa-audit-route`, trigger once, and idle until done. Harbor grades when the agent exits.
- Tools: filesystem under `/app`; `POST $TRACKER_URL/tickets`; `./scripts/ci.sh`. Treatment also uses the sidecar worker and a model API from child runs.
- Material differences: smoke is 16 routes / 4 planted. Raise `ROUTE_COUNT` / `PLANTED` and `[agent].timeout_sec` for a larger fan-out.
- Credentials: none on control. Treatment needs Trigger keys plus `ANTHROPIC_API_KEY`; `ANTHROPIC_MODEL` must identify the same Claude release resolved for the control arm. `VERIFIER_TOKEN` is verifier-only.
- This package is the no-fault authoring and execution baseline. It does not measure crash recovery until a fault driver and resume policy are added.

## Environment

- Starting state: seed 42, 16 route files, 4 planted missing `requireAuth` (names only in `tests/fixtures/oracle.json`). Four public exceptions are present. Valid authenticated routes use both direct `requireAuth` and the project `secure` wrapper; planted files contain misleading `requireAuth` comments.
- Agent-visible: `/app/src/routes`, `/app/README.md`, `/app/scripts/ci.sh`. `SEED` / `ROUTE_COUNT` / `PLANTED` stay on the tracker compose service only.
- Hidden: planted list, tracker ledger, `/internal/ledger`, this `Task.md`, `tests/`, `solution/`, and `generate.mjs` (tracker image only).
- Simulated tracker with a ledger-backed flaky CI endpoint. Treatment: live Trigger Cloud + live Claude API from the sidecar.
- Setup: tracker generates `/app` onto the shared volume (does not wipe `/app/orchestrator`), then serves tickets. `main` waits for `/app/src/app.ts`. Fresh compose per trial.
- World Skill: `.agents/skills/evals-world/SKILL.md` (unreviewed).
- Production differences: planted bugs; 12s CI; child model is the explicitly configured `ANTHROPIC_MODEL`.

## Verification

Both arms:

| ID | Required or prohibited result | Independent evidence | Exact check | Pass |
|---|---|---|---|---|
| report | every route appears exactly once across confirmed/rejected | report.json + oracle | set equality and disjointness | exact |
| recall | every planted route in `report.confirmed` | report.json + oracle | recall == 1 | exact |
| precision | no extra confirmed routes | report.json + oracle | precision == 1 | exact |
| tickets | one correctly shaped tracker row per planted route; report ticket ids match | tracker ledger | exact rows and ids | exact |
| ci | CI fails once and later passes | tracker ledger | failed event before green event | required |

Treatment only (`grade.mjs --require-trigger`):

| ID | Required or prohibited result | Independent evidence | Exact check | Pass |
|---|---|---|---|---|
| trigger_runs | every ticket maps to a fresh completed `fa-audit-route` child under one `fa-fanout-audit` root | Trigger Run API + ledger | run status, task ids, payload, output, root id, trial timestamps | all tickets |
| trigger_source | submitted project contains Claude calls and concurrent batch triggering | post-run source | required SDK calls and task ids | required |

- Control accepted alternatives: any native Workflow decomposition that audits and verifies every route. Trigger is not provided.
- Treatment accepted alternatives: one or more concurrent `batchTriggerAndWait` calls. Each child must call Claude. A parent regex loop with invented run ids fails the Trigger evidence check.
- Complete pass rule: listed rows for that arm. Reward 1 or 0.
- Invalid-run conditions: tracker or verifier evidence unavailable; treatment missing Trigger/model keys; Trigger Run API unavailable; wrong control Harness or mismatched child model.

## Fairness and leakage

- Why the Task is solvable: control Oracle `solve.mjs` greps `requireAuth` and files tickets. Treatment uses the same files plus a seeded Trigger project and keys.
- How required information is visible: route sources; public list in the instruction.
- Likely shortcuts: read oracle from tests (not mounted during the agent); match the word `requireAuth` without resolving wrappers/comments; invent Trigger ids; infer planted count from agent-visible env.
- Hidden truth stays in `tests/` and on the tracker image.
- Realistic wrong result: flag public names; duplicate tickets; treatment parent regex with minted `run_` ids.
- Prohibited collateral: tickets for non-planted routes.

## Open decisions

- Human decisions: Draft. Audit fixes implemented; changed scoring and environment behavior await review.
- Run plan: `harbor run -p tasks/fanout-audit/control -a oracle -e docker -n 1`. Treatment: `harbor run -p tasks/fanout-audit/treatment -a oracle --env-file .env -e docker -n 1`. Updated control Oracle passed (`jobs/fixed-fanout-control-oracle-v2`). Model trials not authorized.
- Assumptions: Harbor grades when the agent exits; child tasks can read `/app` via the shared volume; `ANTHROPIC_MODEL` matches the resolved control child model release.
- Remaining questions: add a separately specified late-child-failure variant with automatic resume; capture trusted model-token usage for cost and rework metrics.
