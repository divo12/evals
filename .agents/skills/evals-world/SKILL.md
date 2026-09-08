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
| Trigger worker isolated from `main` | `tasks/release-train/treatment/environment/trigger-dev/` | seeded project + `trigger dev`; cloud keys |
| Hidden oracle | `tests/fixtures/oracle.json` in each Harbor package | never COPY into the `main` image |
| Ledger grading | `GET /internal/ledger` with `[verifier.env].VERIFIER_TOKEN` | 404 without the bearer token |
| Independent Trigger evidence | ledger callbacks or Trigger Run API | release-train: matching wait-token callbacks; fanout-audit: completed child/root hierarchy |
| Protected code checks | `tasks/release-train/*/environment/protected-check.mjs` | ignores agent-editable `check.mjs` and restricts filesystem access |

## Task Spec guidance

Each comparison is one family with two Harbor packages:

- **Control** — Claude Code ultracode authors and runs a native dynamic Workflow. Compose is `main` plus one sidecar (`world` or `tracker`). No Trigger keys. Require substantive Workflow use in the retained trajectory.
- **Treatment** — the same Claude author setup writes Trigger tasks. Compose adds `trigger-dev`. Same ledger rows, plus `--require-trigger`.

Keep the two worlds identical except compose sidecar, instruction, and the
verifier flag. Copy generators, sidecars, and `grade.mjs` rather than forking
behavior.

Harbor grades when the agent exits. Both arms must keep `main` alive until the
work finishes. Current packages do not inject process faults.

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
- Also pass `TRIGGER_PROJECT_REF`. Fan-out children use `ANTHROPIC_API_KEY`
  and `ANTHROPIC_MODEL` only on the Trigger sidecar. Match that model to the
  control Workflow's resolved Claude release before paired runs.

## Verification guidance

- Verifier copies `tests/` to `/tests` after the agent. Agent failures write a
  reward; missing or corrupt independent evidence exits as infrastructure error
  without writing an agent score.
- Independent truth is the sidecar ledger plus `tests/fixtures/oracle.json`.
- Do not put `VERIFIER_TOKEN` in `[environment.env]` (agent-visible).
- Do not put generator knobs (`SEED`, `ROUTE_COUNT`, `PLANTED`) in
  `[environment.env]`. Keep them on the sidecar compose service only.
- Treatment: `grade.mjs --require-trigger`. Control must not pass that flag.
- Release treatment matches every CI/approval result to a successful Trigger
  wait-token callback and rejects polling. Fanout treatment retrieves each
  claimed child through the Trigger Run API and checks status, task ids,
  payload, output, common root, and creation time against the tracker-start
  timestamp so old runs cannot be replayed.
- Fanout CI success comes from tracker ledger events; files inside `/app` are
  not trusted as CI evidence.

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

- Current packages are no-fault baselines. They do not support durability
  claims until a fault driver and automatic resume policy are implemented.
- `trigger dev` executes tasks locally and is not evidence of production
  deployment durability.
- Cloud Harbor backends that cannot run compose will not hide sidecar oracles; Dockerfile-only packing would leak `/hidden` into `main`.
- Fanout-audit control Oracle (`jobs/fixed-fanout-control-oracle-v2`) proves the
  updated tracker-backed CI, complete report partition, exact tickets, and
  shared grader; it passed all rows with two CI attempts.
- Release-train control Oracle (`jobs/fixed-release-control-oracle`) proves the
  protected CI runner and expanded ledger checks; it passed all rows in 333s.
- World skill has not been human-reviewed.

## Update this skill

Keep Task-specific expected results in each family's `Task.md`. Add a rule
here only when a second family reuses it, or when a run disproves one.
