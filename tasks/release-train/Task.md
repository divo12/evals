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
  - Control: Codex uses `$codex-dynamic-workflows` to plan and run a native subagent workflow; the Codex session remains the runtime for waits and side effects.
  - Treatment: the same Codex configuration authors and runs a Trigger.dev workflow. Waits must be `wait.forToken` / `wait.for` / `wait.until`, not an in-session poll loop.
- Why this case matters: Scenario 5's no-fault long-wait baseline. Same world and grader; only the orchestrator changes.
- Repository, trace, existing Task, or human evidence: naive reference `control/solution/reference-naive.mjs` passed Harbor Oracle on this world; sidecar `treatment/environment/trigger-dev`; world logs `callback.url`.
- Difference from existing Tasks: one family with two Harbor packages.

## Agent input

- Exact initial instruction: `control/instruction.md` or `treatment/instruction.md`.
- Later user turns or event input, if any: none. Operator SIGKILL of `main` is outside the default Harbor trial.
- Context supplied outside the instruction:
  - Both: `RELEASE.md`, `services/`, `vendor/` generated into `/app`; `WORLD_URL=http://world:4747`.
  - Control only: `codex-dynamic-workflows` supplied through Harbor `--skill`.
  - Treatment only: seeded `/app/orchestrator`; `TRIGGER_SECRET_KEY`, `TRIGGER_ACCESS_TOKEN` (`tr_pat_…`), and `TRIGGER_PROJECT_REF`.
  - Treatment only: official `trigger-authoring-tasks` supplied through Harbor `--skill`; full SDK 4.5.16 reference under `/app/orchestrator/node_modules`.

## Relevant agent conditions

- Both arms use Codex with `gpt-5.6-sol`, high reasoning effort, host ChatGPT authentication forwarded by `CODEX_FORCE_AUTH_JSON=1`, the same tool configuration, and the same authoring budget.
- Control: `$codex-dynamic-workflows` and native Codex subagents must perform the service migration/verification decomposition; long waits remain in-process. A trajectory without the skill and substantive subagent work is an invalid arm assignment.
- Treatment: load `trigger-authoring-tasks`, author Trigger tasks, then run the seeded `trigger-once.mjs` helper and exit immediately. The helper owns worker-readiness checks, triggers one accepted run, and writes `/app/trigger-run.json`; the verifier keeps Compose alive and waits up to 720s for `/run/finish`. Seeded `trigger.config.ts` disables default retries (`enabledInDev: false`) because a parent retry after `/run/start` is a relaunch.
- Tools: HTTP to `world:4747`; filesystem under `/app`. Treatment also uses the sidecar worker and Trigger Cloud.
- Material differences from normal operation: default `PROFILE=smoke`; control allows 20 minutes for Codex plus local execution, while treatment allows 15 minutes for authoring/handoff and 14 minutes for verifier waiting. `PROFILE=compressed` / `real` need larger timeouts. Default Harbor does not SIGKILL `main`, so this package alone makes no crash-recovery claim.
- Credentials: none on control. Treatment needs `TRIGGER_SECRET_KEY` (`tr_dev_…`), `TRIGGER_ACCESS_TOKEN` (`tr_pat_…` for `trigger dev`), and `TRIGGER_PROJECT_REF` from operator `.env`. Do not set `TRIGGER_ACCESS_TOKEN` to the project secret. `VERIFIER_TOKEN` is verifier-only.

## Environment

Shared:

- 12 services pinned to acme-utils 1.4.2; batches in `RELEASE.md`; hidden degrade/flaky lists in the world image and each package's `tests/fixtures/oracle.json`.
- Agent-visible: `/app/**`, `GET /windows`, documented world APIs.
- Hidden: oracle, ledger, `/internal/ledger`, this `Task.md`, `tests/`, `solution/`.
- Simulated world; CI runs a protected test runner from the world image under Node filesystem permissions and verifies the 2.0 vendor hash. Agent-editable `check.mjs` is only a local development aid.
- Wall clock; compose DNS; 2 CPU / 4 GiB; fresh stack per trial; healthcheck `GET /health`.
- World Skill: `.agents/skills/evals-world/SKILL.md` (unreviewed).
- Production differences: compressed timings; world is one process.

Control-only: compose is `main` + `world`. No Trigger keys. No sidecar.

Treatment-only: compose adds `trigger-dev` (seeds `/app/orchestrator` with `defineConfig`, `@trigger.dev/sdk` + `@trigger.dev/build` 4.5.16, and a `worker-ready` ping task, then runs `trigger dev`). `network_mode = "public"` so `world` can POST wait-token URLs. Cloud `deploy` is invalid (worker would leave the compose net). `trigger dev` authenticates with a personal access token, not the project secret.

Treatment handoff: the Codex process ends after writing a Trigger run handle.
`tests/test.sh` uses verifier-only ledger access to wait for the asynchronous
workflow before invoking the shared grader. The run handle decides whether to
wait; it is not trusted as success evidence.

## Verification

Both arms, from the world ledger:

| ID | Required or prohibited result | Independent evidence | Exact check or bounded semantic question | Pass condition |
|---|---|---|---|---|
| canary_once | each service canaried once | ledger `deploy` effects | count canary per service | == 1 |
| promote_healthy | healthy services promoted once | ledger + oracle.degrade | count promote | == 1 for healthy |
| rollback_degraded | degraded rolled back once, never promoted | ledger + oracle | count rollback/promote | rollback==1, promote==0 |
| idempotency | every deploy effect has idempotencyKey | ledger | field present | all true |
| gates | each batch approved once; canary after approval | ledger timestamps | request count and order | exact |
| ci | every service CI-green at 2.0.0 | protected runner + ledger | final successful CI result per service | exact |
| rollback_latency | rollback soon after errorRate crosses 5% | ledger + windows.degradeAfter | seconds vs tolerance | within bound |
| follow_up | one `#releases` notify after followUp of last promote, correct lists | ledger notify + oracle | count, delta, patched/rolledBack sets | exact |
| autonomy | exactly one `/run/start` | ledger | count | == 1 |
| finish | every service re-read; exactly one `/run/finish` after follow-up | ledger | reads and event order | exact |

Treatment only (`grade.mjs --require-trigger`):

| ID | Required or prohibited result | Independent evidence | Exact check or bounded semantic question | Pass condition |
|---|---|---|---|---|
| trigger_ci | every CI completion resumes a Trigger wait | ledger `callback` | matching run id, HTTP 2xx, hostname `*.trigger.dev` | all CI results |
| trigger_approval | every approval resumes a Trigger wait | ledger `callback` | matching approval id, HTTP 2xx, hostname `*.trigger.dev` | all approvals |
| no_polling | no CI or approval polling | ledger | poll counts | zero |

- Control accepted alternatives: any `$codex-dynamic-workflows` decomposition for migration and verification, with session-local wait/deploy logic. Trigger is not provided.
- Treatment accepted alternatives: any Trigger task graph that uses wait tokens for CI and approvals. A polling loop that finishes the ledger still fails the Trigger rows.
- Complete pass rule: listed rows for that arm AND relaunches == 0. Reward 1 or 0.
- Invalid-run conditions: world unhealthy; protected CI or ledger unavailable during the verifier wait; missing control skill/subagent use; missing treatment Trigger skill or keys; mismatched author model, reasoning, tools, or budget.

## Fairness and leakage

- Why the Task is solvable: control Oracle `reference-naive.mjs` passes `PROFILE=smoke`. Treatment uses the same world plus a seeded Trigger project and keys.
- How required information is visible: `RELEASE.md`, `MIGRATION.md`, `/windows`, metrics during canary. Treatment also sees `/app/orchestrator` and Trigger env vars.
- Likely shortcuts: edit agent-visible `check.mjs`; call `/internal/ledger`; ignore Trigger and poll; fake `arm: trigger`; `trigger deploy`. Protected CI ignores editable tests and cannot read the hidden oracle.
- Hidden truth stays off `main`: oracle and ledger on the world image; `tests/` uploaded after the agent; this `Task.md` is outside both Harbor build contexts.
- Realistic wrong result: promote a degraded service; skip follow-up; treatment ledger-perfect poll loop.
- Prohibited collateral: modifying the vendored 2.0 library; extra `#releases` notifies; deploy without idempotencyKey.

## Open decisions

- Human decisions: Draft. Audit fixes implemented; changed scoring and protected CI behavior await review.
- Run plan executed: control plus fire-and-exit treatment Oracles and `gpt-5.6-sol` high-reasoning Codex trials; no judge. Control timeout 1200s; treatment author timeout 900s and verifier timeout 840s.
- Assumptions: Harbor starts the treatment verifier when Codex exits; the verifier keeps Compose alive; `world` hostname works; treatment `world` has egress to `api.trigger.dev`.
- Remaining questions: add a separately specified orchestrator-kill variant with an automatic resume policy; whether `PROFILE=compressed` should be the default scored timeout.

## Calibration evidence

- Oracle control: `jobs/codex-release-oracle-control`, reward 1, no exception.
- Fire-and-exit Oracle treatment: `jobs/release-treatment-helper-oracle`, reward
  1, no exception. Agent handoff 5s; verifier wait 387s; 19 successful Trigger
  callbacks and zero CI/approval polls.
- Codex control: `jobs/codex-release-train-control-20260908T101855Z`, reward
  1, no exception, 826s total. The skill created workflow artifacts and three
  native batch-migration subagents. World ledger span: 594s. Harbor reported
  only its most recent rollout's $0.1725632 cost, so control's aggregate token
  and cost metrics are incomplete.
- Fire-and-exit Codex treatment: `jobs/release-treatment-helper-codex`, reward
  1, no exception, 930s total. Codex authored and handed off in 533s; the
  verifier waited 307s with no model active. Usage was 467,034 input / 416,768
  cached / 14,307 output tokens and $0.6539112. The run used 19 callbacks and
  zero CI/approval polls; world ledger span 316s.
- Superseded monitoring treatment: `jobs/codex-release-treatment-1200s`, reward
  1 and $1.5184352, but Codex stayed alive to monitor Trigger. It is not part of
  the current comparison.
- Invalid setup evidence: `jobs/codex-release-train-control-20260908T101210Z`
  used Harbor's empty API-key fallback and failed 401 before agent work.
  `jobs/codex-release-train-treatment-20260908T101855Z` reached reward 1 but
  hit the old 900s agent timeout before clean exit.
  `jobs/release-treatment-fire-exit-codex` hit an experimental 600s authoring
  cutoff before handoff. None is scored.
- One trial per arm establishes reachability, not a stable performance ranking.
  Cost is not comparable until control is rerun with valid unredacted parent
  and subagent artifacts and summarized across all sessions.
