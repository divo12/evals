# Task: release-train

**Status:** Draft

<!--
Human control-plane spec for both arms. Lives at the family root so it is not
inside a Harbor build context. Do not copy or mount it into either agent image.
-->

Two Harbor packages, one world, one ledger:

| Arm | Harbor path | Instruction |
|---|---|---|
| Control | `tasks/release-train/control` | `control/instruction.md` |
| Treatment | `tasks/release-train/treatment` | `treatment/instruction.md` |

## Purpose and evidence

- Work the agent must accomplish: migrate 12 services off a vulnerable library, pass real CI, wait for delayed per-batch approvals, canary, roll back services that degrade, promote the rest, then post one follow-up after a delay.
- Capability being tested:
  - Control: unattended session-bound orchestration. The agent stays in `main` and drives the world itself.
  - Treatment: Claude writes a Trigger.dev workflow. Waits must be `wait.forToken` / `wait.for` / `wait.until`, not an in-session poll loop.
- Why this case matters: Scenario 5. Same world and grader; only the orchestrator changes.
- Repository, trace, existing Task, or human evidence: naive reference `control/solution/reference-naive.mjs` passed Harbor Oracle on this world; sidecar `treatment/environment/trigger-dev`; world logs `callback.url`.
- Difference from existing Tasks: one family with two packages. Warmup is `tasks/ultracode-auth-audit`.

## Agent input

- Exact initial instruction: `control/instruction.md` or `treatment/instruction.md`.
- Later user turns or event input, if any: none. Operator SIGKILL of `main` is outside the default Harbor trial.
- Context supplied outside the instruction:
  - Both: `RELEASE.md`, `services/`, `vendor/` generated into `/app`; `WORLD_URL=http://world:4747`.
  - Treatment only: seeded `/app/orchestrator`; `TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_REF`.

## Relevant agent conditions

- Control: long idle waits in-process. The session must stay alive until the train finishes.
- Treatment: author Trigger tasks, start one run, then idle. Harbor grades when the agent exits, so `main` must outlast the workflow even though the worker does the waits.
- Tools: HTTP to `world:4747`; filesystem under `/app`. Treatment also uses the sidecar worker and Trigger Cloud.
- Material differences from normal operation: default `PROFILE=smoke`. `PROFILE=compressed` / `real` need a larger `[agent].timeout_sec`. Default Harbor does not SIGKILL `main`.
- Credentials: none on control. Treatment needs `TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_REF` from operator `.env`. `VERIFIER_TOKEN` is verifier-only.

## Environment

Shared:

- 12 services pinned to acme-utils 1.4.2; batches in `RELEASE.md`; hidden degrade/flaky lists in the world image and each package's `tests/fixtures/oracle.json`.
- Agent-visible: `/app/**`, `GET /windows`, documented world APIs.
- Hidden: oracle, ledger, `/internal/ledger`, this `Task.md`, `tests/`, `solution/`.
- Simulated world; CI runs `check.mjs` on the shared `workspace` volume.
- Wall clock; compose DNS; 2 CPU / 4 GiB; fresh stack per trial; healthcheck `GET /health`.
- World Skill: `.agents/skills/evals-world/SKILL.md` (unreviewed).
- Production differences: compressed timings; world is one process.

Control-only: compose is `main` + `world`. No Trigger keys. No sidecar.

Treatment-only: compose adds `trigger-dev` (seeds `/app/orchestrator`, runs `trigger dev`). `network_mode = "public"` so `world` can POST wait-token URLs. Cloud `deploy` is invalid (worker would leave the compose net).

## Verification

Both arms, from the world ledger:

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

Treatment only (`grade.mjs --require-trigger`):

| ID | Required or prohibited result | Independent evidence | Exact check or bounded semantic question | Pass condition |
|---|---|---|---|---|
| trigger_ci | at least one CI completion via Trigger | ledger `callback` | `event=ci.finished`, HTTP 2xx, hostname `*.trigger.dev` | >= 1 |
| trigger_approval | at least one approval via Trigger | ledger `callback` | `event=approval.decided`, HTTP 2xx, hostname `*.trigger.dev` | >= 1 |

- Control accepted alternatives: any in-session orchestrator. Trigger is not provided.
- Treatment accepted alternatives: any Trigger task graph that uses wait tokens for CI and approvals. A polling loop that finishes the ledger still fails the Trigger rows.
- Complete pass rule: listed rows for that arm AND relaunches == 0. Reward 1 or 0.
- Invalid-run conditions: world unhealthy; ledger fetch failure; treatment missing Trigger keys if the sidecar never attached (infra).

## Fairness and leakage

- Why the Task is solvable: control Oracle `reference-naive.mjs` passes `PROFILE=smoke`. Treatment uses the same world plus a seeded Trigger project and keys.
- How required information is visible: `RELEASE.md`, `MIGRATION.md`, `/windows`, metrics during canary. Treatment also sees `/app/orchestrator` and Trigger env vars.
- Likely shortcuts: read `/hidden` on world; call `/internal/ledger` without the verifier token; edit tests. Treatment: ignore Trigger and poll (fails `--require-trigger`); fake `arm: trigger`; `trigger deploy`.
- Hidden truth stays off `main`: oracle and ledger on the world image; `tests/` uploaded after the agent; this `Task.md` is outside both Harbor build contexts.
- Realistic wrong result: promote a degraded service; skip follow-up; treatment ledger-perfect poll loop.
- Prohibited collateral: extra `#releases` notifies; deploy without idempotencyKey.

## Open decisions

- Human decisions: Draft. Layout `control/` + `treatment/` with family spec at this root.
- Run plan: `harbor run -p tasks/release-train/control -a oracle -e docker -n 1`. Treatment has no Oracle solution. Model trials not authorized.
- Assumptions: Harbor grades when the agent exits; `world` hostname works; treatment `world` has egress to `api.trigger.dev`.
- Remaining questions: Trigger reference `solve.sh`; whether Harbor should wait on world completion instead of agent exit; whether `PROFILE=compressed` should be the default scored timeout.
