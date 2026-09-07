# Task: ultracode-auth-audit

**Status:** Draft

<!--
Keep this control-plane spec beside task.toml. Do not copy or mount it into the
evaluated agent's workspace or image.
-->

## Purpose and evidence

- Work the agent must accomplish: find every planted missing-`requireAuth` route, file exactly one tracker ticket per confirmed finding, skip public routes, run flaky CI until it passes, write `report.json`.
- Capability being tested: fan-out audit with side effects and a wait that outlasts a naive one-shot script if `CI_SECONDS` is raised; Harbor default uses 12s CI.
- Why this case matters: Scenario 5 warm-up (dynamic workflow / ultracode vs a durable orchestrator) with an external ledger.
- Repository, trace, existing Task, or human evidence: existing `tasks/ultracode-auth-audit/` generator; ITSMBench compose + hidden tests; Harbor 0.22.
- Difference from existing Tasks: Harbor/Docker packaging; oracle moved to `tests/fixtures/` and off the agent image.

## Agent input

- Exact initial instruction: `instruction.md`.
- Later user turns or event input, if any: none.
- Context supplied outside the instruction: generated `/app` API repo; `TRACKER_URL=http://tracker:9410`.

## Relevant agent conditions

- Agent behavior that affects this Task: independent confirmation of findings, exactly-once tickets, retrying CI.
- Tools, interfaces, session, memory, or timing behavior this Task depends on: filesystem, HTTP POST to tracker, `./scripts/ci.sh`.
- Material differences between the evaluated Harness and normal operation: `CI_SECONDS=12` for Harbor Oracle. Setting 240+ reproduces the ultracode stall-watchdog condition; raise `[agent].timeout_sec`.
- Required credential names and access: none. `VERIFIER_TOKEN` is verifier-only.

## Environment

- Starting state: 40 route files, 6 public, 12 planted missing auth (seed 42).
- Agent-visible information: `/app/src/routes`, README, instruction public-route list.
- Information hidden from the agent: planted list (`tests/fixtures/oracle.json`), tracker ledger file, generator script (removed after image build).
- Simulated dependencies: tracker sidecar; CI script is local bash, not a real CI system.
- Setup, readiness, reset, and cleanup: tracker healthcheck; fresh compose per trial; ledger cleared on tracker start.
- Relevant project World Skill: `.agents/skills/evals-world/SKILL.md` (unreviewed).
- Material differences from production: planted bugs, fake CI sleep.

## Verification

| ID | Required or prohibited result | Independent evidence | Exact check | Pass |
|---|---|---|---|---|
| recall | every planted route in `report.confirmed` | report.json + oracle | recall == 1 | exact |
| precision | no extra confirmed routes | report.json + oracle | precision == 1 | exact |
| tickets | one tracker row per planted route, none extra, no duplicates | tracker ledger | counts | exact |
| ci | CI was retried to success | `/app/.ci-attempt` present (informational) | exists | not required for reward |

- Accepted alternatives: any order of tickets; extra `rejected` names that are not filed.
- Complete pass rule: recall 1, precision 1, one ticket per planted route, zero extras, zero duplicates.
- Invalid-run conditions: tracker unreachable from verifier.

## Fairness and leakage

- Why the Task is solvable: `solution/solve.mjs` reads files and files tickets.
- How required information is visible: route sources; public list in the instruction.
- Likely shortcuts: reading oracle from tests (not mounted during agent); grepping for a canary string (none planted).
- Hidden truth stays in `tests/` uploaded after the agent and on the tracker image ledger.
- Realistic wrong result: flagging public routes; duplicate tickets on retry.
- Prohibited collateral change: tickets for non-planted routes.

## Open decisions

- Human decisions: Draft packaging as part of the Harbor conversion.
- Run plan: `harbor run -p tasks/ultracode-auth-audit -a oracle -e docker -n 1`. Model trials not authorized.
- Assumptions: compose hostname `tracker`.
- Remaining questions: whether the scored run should default to `CI_SECONDS=240`.
