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
  - Control: Claude-style fan-out (subagents or a dynamic workflow script). The session is the runtime.
  - Treatment: Claude writes a Trigger.dev parent that `batchTriggerAndWait`s child tasks. Each child is a real model subagent (`generateText` / `AgentChat`), not a regex.
- Why this case matters: Scenario 5 agent/subagent comparison. Same files and grader; only the substrate changes. `release-train` already covers long waits.
- Repository, trace, existing Task, or human evidence: recovered generator/tracker/grader from the retired `ultracode-auth-audit` package (`42fbc07`); Claude workflow docs (`agent` + `pipeline`); Trigger `batchTriggerAndWait` + child model calls.
- Difference from existing Tasks: fan-out of LLM workers, not timed canaries. Family layout matches `tasks/release-train`.

## Agent input

- Exact initial instruction: `control/instruction.md` or `treatment/instruction.md`.
- Later user turns or event input, if any: none.
- Context supplied outside the instruction:
  - Both: generated `/app` API repo; `TRACKER_URL=http://tracker:9410`; `CI_SECONDS`.
  - Treatment only: seeded `/app/orchestrator`; Trigger keys; `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL`, `AZURE_OPENAI_DEPLOYMENT`.

## Relevant agent conditions

- Control: spawn workers or write `agent()` / `pipeline()` JS; stay in `main` until CI is green.
- Treatment: author parent + child tasks, trigger once, idle until done. Harbor grades when the agent exits.
- Tools: filesystem under `/app`; `POST $TRACKER_URL/tickets`; `./scripts/ci.sh`. Treatment also uses the sidecar worker and a model API from child runs.
- Material differences: smoke is 16 routes / 4 planted. Raise `ROUTE_COUNT` / `PLANTED` and `[agent].timeout_sec` for a larger fan-out.
- Credentials: none on control. Treatment needs Trigger keys and Azure OpenAI (`AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL`, `AZURE_OPENAI_DEPLOYMENT`). `VERIFIER_TOKEN` is verifier-only.

## Environment

- Starting state: seed 42, 16 route files, 4 planted missing `requireAuth` (names only in `tests/fixtures/oracle.json`). Public-name exceptions are listed in the instruction; this smoke slice may not include those filenames.
- Agent-visible: `/app/src/routes`, `/app/README.md`, `/app/scripts/ci.sh`. `SEED` / `ROUTE_COUNT` / `PLANTED` stay on the tracker compose service only.
- Hidden: planted list, tracker ledger, `/internal/ledger`, this `Task.md`, `tests/`, `solution/`, and `generate.mjs` (tracker image only).
- Simulated tracker; local flaky `ci.sh`. Treatment: live Trigger Cloud + live model API from the sidecar.
- Setup: tracker generates `/app` onto the shared volume (does not wipe `/app/orchestrator`), then serves tickets. `main` waits for `/app/src/app.ts`. Fresh compose per trial.
- World Skill: `.agents/skills/evals-world/SKILL.md` (unreviewed).
- Production differences: planted bugs; 12s CI; child model is whatever key Harbor injects.

## Verification

Both arms:

| ID | Required or prohibited result | Independent evidence | Exact check | Pass |
|---|---|---|---|---|
| recall | every planted route in `report.confirmed` | report.json + oracle | recall == 1 | exact |
| precision | no extra confirmed routes | report.json + oracle | precision == 1 | exact |
| tickets | one tracker row per planted route, none extra, no duplicates | tracker ledger | counts | exact |
| ci | CI retried (informational) | `/app/.ci-attempt` | exists | not required for reward |

Treatment only (`grade.mjs --require-trigger`):

| ID | Required or prohibited result | Independent evidence | Exact check | Pass |
|---|---|---|---|---|
| trigger_runs | every ticket carries a Trigger run id | ledger `triggerRunId` | matches `^run_` | all tickets |

- Control accepted alternatives: turn-by-turn subagents, a Claude workflow script, or a local script. Trigger is not provided.
- Treatment accepted alternatives: `batchTriggerAndWait` or equivalent child triggers; `generateText` or `AgentChat` in the child. A parent regex loop that still files perfect tickets fails the Trigger row.
- Complete pass rule: listed rows for that arm. Reward 1 or 0.
- Invalid-run conditions: tracker unreachable; treatment missing Trigger or model keys if the sidecar never attached (infra).

## Fairness and leakage

- Why the Task is solvable: control Oracle `solve.mjs` greps `requireAuth` and files tickets. Treatment uses the same files plus a seeded Trigger project and keys.
- How required information is visible: route sources; public list in the instruction.
- Likely shortcuts: read oracle from tests (not mounted during the agent); grep without confirming (allowed on control Oracle, not the intended treatment child); fake `triggerRunId` on tickets (instruction-mandated `run_` prefix, not Cloud-verified); infer planted count from agent-visible env (removed from `task.toml`).
- Hidden truth stays in `tests/` and on the tracker image.
- Realistic wrong result: flag public names; duplicate tickets; treatment parent regex with minted `run_` ids.
- Prohibited collateral: tickets for non-planted routes.

## Open decisions

- Human decisions: Draft. End-to-end build requested after design approval.
- Run plan: `harbor run -p tasks/fanout-audit/control -a oracle -e docker -n 1`. Treatment: `harbor run -p tasks/fanout-audit/treatment -a oracle --env-file .env -e docker -n 1`. Control Oracle passed (`jobs/2026-09-07__23-24-47`). Model trials not authorized.
- Assumptions: Harbor grades when the agent exits; child tasks can read `/app` via the shared volume; children call Azure OpenAI with the injected deployment.
- Remaining questions: verify `triggerRunId` against Cloud instead of prefix; whether default Harbor agent is Claude Code with the Workflow tool (control arm A) or only Task-tool subagents (arm D).
