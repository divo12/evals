# Task: release-train

**Status:** Draft

<!--
Keep this control-plane spec beside task.toml. Do not copy or mount it into the
evaluated agent's workspace or image.
-->

## Purpose and evidence

- Work the agent must accomplish: migrate 12 services off a vulnerable library, pass real CI, wait for delayed per-batch approvals, canary, roll back services that degrade, promote the rest, then post one follow-up after a delay.
- Capability being tested: unattended durable orchestration (waits, idempotent side effects, recovery without a human relaunch) versus a session-bound coding agent.
- Why this case matters: this is the Scenario 5 comparison (Claude workflow vs Claude writing a Trigger.dev workflow) on a realistic Patch-Tuesday shape.
- Repository, trace, existing Task, or human evidence: prior local Node world + naive reference at `tasks/release-train/`; ITSMBench Harbor layout (`tasks/task-a-1` compose sidecar + hidden tests); Harbor 0.22 task format.
- Difference from existing Tasks: this is the Harbor/Docker packaging of the existing release-train environment, not a new scenario.

## Agent input

- Exact initial instruction: `instruction.md` in this directory.
- Later user turns or event input, if any: none. Faults are operator-injected outside the default Harbor Oracle run.
- Context supplied outside the instruction: `RELEASE.md`, `services/`, `vendor/` generated into `/app`; `WORLD_URL=http://world:4747`.

## Relevant agent conditions

- Agent behavior that affects this Task: long idle waits, retries on flaky CI, exactly-once deploys, clocked follow-up.
- Tools, interfaces, session, memory, or timing behavior this Task depends on: HTTP to the world sidecar; filesystem edits under `/app`.
- Material differences between the evaluated Harness and normal operation: Harbor default profile is `smoke` (minutes). `PROFILE=compressed` (~3h) and `PROFILE=real` (~1.5d) are the graded product comparison; raise `[agent].timeout_sec` before those runs.
- Required credential names and access: none. Verifier-only `VERIFIER_TOKEN` is in `[verifier.env]`, not the agent environment.

## Environment

- Starting state and important relationships: 12 services pinned to acme-utils 1.4.2; batches in `RELEASE.md`; hidden degrade/flaky lists in the world image and `tests/fixtures/oracle.json`.
- Agent-visible information and normal discovery paths: `/app/**`, `GET /windows`, documented world APIs.
- Information hidden from the agent: oracle (which canaries degrade, which CI flakes), ledger file, `/internal/ledger`, `Task.md`, `tests/`, `solution/`.
- Live, frozen, or simulated dependencies: simulated world sidecar; CI really runs `check.mjs` on the agent's files via the shared `workspace` volume.
- Identity, permissions, clock, network, and resource limits: wall clock; Docker Compose network; 2 CPU / 4 GiB.
- Setup, readiness, reset, and cleanup: world entrypoint generates `/app` on an empty volume; healthcheck `GET /health`; fresh compose stack per Harbor trial.
- Relevant project World Skill references, scripts, or assets: `.agents/skills/evals-world/SKILL.md` (unreviewed).
- Material differences from production: timings compressed; world is one process not real CI/CD vendors.

## Verification

| ID | Required or prohibited result | Independent evidence | Exact check or bounded semantic question | Pass condition |
|---|---|---|---|---|
| canary_once | each service canaried once | ledger `deploy` effects | count canary per service | == 1 |
| promote_healthy | healthy services promoted once | ledger + oracle.degrade | count promote | == 1 for healthy |
| rollback_degraded | degraded rolled back once, never promoted | ledger + oracle | count rollback/promote | rollback==1, promote==0 |
| idempotency | every deploy effect has idempotencyKey | ledger | field present | all true |
| gates | each batch approved once; canary after approval | ledger timestamps | request count and order | exact |
| rollback_latency | rollback soon after errorRate crosses 5% | ledger + windows.degradeAfter | seconds vs tolerance | within bound |
| follow_up | one `#releases` notify after followUp of last promote, correct lists | ledger notify + oracle | count, delta, patched/rolledBack sets | exact |
| autonomy | exactly one `/run/start` | ledger | count | == 1 |

- Accepted alternatives: any orchestrator (script, Trigger.dev, wait loops) as long as ledger invariants hold.
- Complete pass rule: all rows pass AND relaunches == 0. Reward 1 or 0.
- Invalid-run conditions: world unhealthy, ledger fetch failure (verifier should not treat as a fair agent zero if `/internal/ledger` is unreachable — currently logged as infra in `error.txt` but Harbor still needs a reward file).

## Fairness and leakage

- Why the Task is solvable: naive reference `solution/reference-naive.mjs` passes `PROFILE=smoke` with no faults.
- How required information is visible or discoverable: `RELEASE.md`, `MIGRATION.md`, `/windows`, metrics during canary.
- Likely shortcuts or reward hacks: reading `/hidden` on the world container (not mounted on main); calling `/internal/ledger` without the verifier token (404); editing tests (not in the agent image).
- How hidden truth and Verifier logic stay unavailable: oracle lives on the world image and in `tests/` uploaded after the agent; compose does not mount `tests/` or `Task.md` into main.
- Realistic wrong result that must fail: promote a degraded service; skip follow-up; duplicate canary.
- Prohibited collateral change that must fail: extra tickets/notifies on `#releases`; deploy without idempotencyKey.

## Open decisions

- Human decisions: Draft packaging authorized as an end-to-end Harbor conversion without a spec-approval pause.
- Run plan: Harbor 0.22, `harbor run -p tasks/release-train -a oracle -e docker -n 1` for the reference path. Model trials not authorized.
- Assumptions: Compose sidecar `world` is reachable as hostname `world` from `main`.
- Remaining questions: whether `PROFILE=compressed` should be the default scored Harbor timeout.
