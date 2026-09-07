---
name: evals-world
description: Use with eval-engineering when generating Task Specs or building Harbor Tasks for this Trigger.dev durable-agent evals repository. Unreviewed bootstrap.
---

# evals World Knowledge

Read `$eval-engineering` first. Use its broad references and examples as
guidance. Use this skill for reusable knowledge about how that guidance applies
to this project.

This skill is an **unreviewed** bootstrap. Do not treat it as human-approved.

## Start here

- Read `README.md` for Harbor run commands.
- Family specs: `tasks/release-train/Task.md`, `tasks/fanout-audit/Task.md`. Draft.
- Harbor packages: `<family>/control` and `<family>/treatment`.
- Pinned Harbor CLI: 0.22.0 (`harbor --version`).
- Layout follows ITSMBench. Human `Task.md` / `README.md` sit at the family
  root, outside either Harbor build context.

## Knowledge routing

| Current need | Read or run | What it provides |
|---|---|---|
| Two-arm design | `tasks/release-train/Task.md` or `tasks/fanout-audit/Task.md` | Control vs treatment, shared grader, Trigger extra rows |
| Harbor package shape | `tasks/release-train/control/task.toml` | schema_version 1.4 example used in this repo |
| Sidecar world + shared workspace volume | `tasks/release-train/control/environment/docker-compose.yaml` | agent edits `/app`; sidecar acts on those files |
| Generate-on-volume without leaking the generator | `tasks/fanout-audit/control/environment/Dockerfile.tracker` | generate lives on the sidecar image, not `main` |
| Trigger worker that survives the agent | `tasks/release-train/treatment/environment/trigger-dev/` | seeded project + `trigger dev`; cloud keys |
| Hidden oracle | `tests/fixtures/oracle.json` in each Harbor package | never COPY into the `main` image |
| Ledger grading | `GET /internal/ledger` with `[verifier.env].VERIFIER_TOKEN` | 404 without the bearer token |
| Independent Trigger evidence | ledger `callback.url` or `triggerRunId` | release-train: `*.trigger.dev` + HTTP 2xx; fanout-audit: `^run_` on every ticket |

## Task Spec guidance

Each comparison is one family with two Harbor packages:

- **Control** — session-bound. Compose is `main` plus one sidecar (`world` or `tracker`). No Trigger keys.
- **Treatment** — agent writes Trigger tasks. Compose adds `trigger-dev`. Same ledger rows, plus `--require-trigger`.

Keep the two worlds identical except compose sidecar, instruction, and the
verifier flag. Copy generators, sidecars, and `grade.mjs` rather than forking
behavior.

Harbor grades when the agent exits. Both arms must keep `main` alive until the
work finishes. SIGKILL of `main` is operator-injected, not the default Harbor
Oracle.

Do not store planted route lists or degrade-service names here.

## Environment guidance

- Primary compose service must be `main`. Sidecars use Docker network aliases.
- Generate agent-visible files on a sidecar, not in `main`. A volume mount on
  `/app` hides image files there; putting `generate.mjs` on `main` at `/opt`
  still leaks planted-set logic to the agent.
- When `/app` also holds `/app/orchestrator`, generation must not `rmSync` the
  whole workspace. Delete only generated paths (`src`, `scripts`, app
  manifests).
- Bind sidecar HTTP on `0.0.0.0`, not `127.0.0.1`.
- Fresh compose stack per Harbor trial is the isolation method.
- Treatment needs `network_mode = "public"` so wait-token callbacks and Cloud
  / model APIs work. Cloud `deploy` cannot reach compose aliases.
- Volume mount hides image files under `/app`. The Trigger sidecar copies
  `/opt/seed` onto the volume, then `exec trigger dev`.
- Pin `trigger.dev` CLI, `@trigger.dev/sdk`, and `@trigger.dev/build` to the
  same version. Write `trigger.config.ts` with `defineConfig`. Default retries
  must be off in treatment (`retries.enabledInDev = false`); a parent retry
  after `/run/start` is a relaunch. Prefer wait tokens in one parent task —
  `trigger dev` child `batchTriggerAndWait` often dies with
  `COULD_NOT_FIND_EXECUTOR`.
- `trigger dev` (CLI 4.5) requires `TRIGGER_ACCESS_TOKEN` as a personal token
  (`tr_pat_…`). `TRIGGER_SECRET_KEY` (`tr_dev_…`) is only for the SDK / REST
  trigger API. Never set `TRIGGER_ACCESS_TOKEN` from the project secret — the
  CLI then refuses to start and Cloud runs sit in `PENDING_VERSION`.
- Also pass `TRIGGER_PROJECT_REF`. Fan-out children that call a model also
  need `ANTHROPIC_API_KEY` on the sidecar.

## Verification guidance

- Verifier copies `tests/` to `/tests` after the agent. `test.sh` must always
  write `/logs/verifier/reward.txt`.
- Independent truth is the sidecar ledger plus `tests/fixtures/oracle.json`.
- Do not put `VERIFIER_TOKEN` in `[environment.env]` (agent-visible).
- Do not put generator knobs (`SEED`, `ROUTE_COUNT`, `PLANTED`) in
  `[environment.env]`. Keep them on the sidecar compose service only.
- Treatment: `grade.mjs --require-trigger`. Control must not pass that flag.
- `--require-trigger` is family-specific: release-train checks callback
  hostnames; fanout-audit checks ledger `triggerRunId` matches `^run_`.

## Run and audit guidance

```bash
harbor run -p tasks/release-train/control -a oracle -e docker -n 1 -y
harbor run -p tasks/release-train/treatment -a oracle --env-file .env -e docker -n 1 -y
harbor run -p tasks/fanout-audit/treatment -a oracle --env-file .env -e docker -n 1 -y
```

Jobs belong under `jobs/` (gitignored). Do not start scored model trials
without an explicit run plan.

## Existing Task coverage

| Task | Condition |
|---|---|
| [release-train](../../../tasks/release-train/Task.md) | Long waits, canary, delayed approvals |
| [fanout-audit](../../../tasks/fanout-audit/Task.md) | Fan-out of model children over planted route files |

## Known limits and open questions

- Harbor Oracle path does not inject SIGKILL/sleep faults; those remain operator-driven.
- Cloud Harbor backends that cannot run compose will not hide sidecar oracles; Dockerfile-only packing would leak `/hidden` into `main`.
- Treatment arms have no `solution/solve.sh`.
- Fanout treatment `--require-trigger` checks a `run_` prefix, not Cloud membership.
- `test.sh` writes reward `0` when the ledger fetch fails. That is an infra miss scored as a failed agent, same as release-train.
- Fanout-audit control Oracle (`jobs/2026-09-07__23-24-47`) proved: tracker generate-then-healthcheck, two CI attempts (12s flake then pass), ledger recall/precision/tickets, `requireTrigger=false`.
- World skill has not been human-reviewed.

## Update this skill

Keep Task-specific expected results in each family's `Task.md`. Add a rule
here only when a second family reuses it, or when a run disproves one.
