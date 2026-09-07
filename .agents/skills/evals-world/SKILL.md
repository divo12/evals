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
- Family spec: `tasks/release-train/Task.md` (both arms). Warmup: `tasks/ultracode-auth-audit/Task.md`. All Draft.
- Harbor packages: `tasks/release-train/control`, `tasks/release-train/treatment`, `tasks/ultracode-auth-audit`.
- Pinned Harbor CLI: 0.22.0 (`harbor --version`).
- Layout follows ITSMBench. Human `Task.md` / `README.md` for release-train sit at the family root, outside either Harbor build context.

## Knowledge routing

| Current need | Read or run | What it provides |
|---|---|---|
| Two-arm design | `tasks/release-train/Task.md` | Control vs treatment, shared grader, Trigger extra rows |
| Harbor package shape | `tasks/release-train/control/task.toml` | schema_version 1.4 example used in this repo |
| Sidecar world + shared workspace volume | `tasks/release-train/control/environment/docker-compose.yaml` | agent edits `/app`; world runs `check.mjs` on those files |
| Trigger worker that survives the agent | `tasks/release-train/treatment/environment/trigger-dev/` | seeded project + `trigger dev`; cloud keys |
| Hidden oracle | `tests/fixtures/oracle.json` in each Harbor package | never COPY into the `main` image |
| Ledger grading | `GET /internal/ledger` with `[verifier.env].VERIFIER_TOKEN` | 404 without the bearer token |
| Independent Trigger evidence | ledger `callback.url` hostname | `*.trigger.dev` + HTTP 2xx; do not trust `/run/start` arm |

## Task Spec guidance

- **Control** `tasks/release-train/control` — session-bound orchestrator. Compose is `main` + `world`. No Trigger keys.
- **Treatment** `tasks/release-train/treatment` — agent writes Trigger tasks. Compose adds `trigger-dev`. Same ledger rows, plus `--require-trigger`.
- **Auth-audit fan-out** `tasks/ultracode-auth-audit` — planted missing `requireAuth`, tracker side effects, flaky CI.

Do not store planted route lists or degrade-service names here.

Keep the two release-train worlds identical except compose sidecar, instruction, and the verifier flag. Copy `world.mjs` / `generate.mjs` / `grade.mjs` rather than forking behavior.

Harbor grades when the agent exits. Both arms must keep `main` alive until the train finishes. SIGKILL of `main` is operator-injected, not the default Harbor Oracle.

## Environment guidance

- Primary compose service must be `main`. Sidecars use Docker network aliases (`world`, `tracker`).
- Generate agent-visible files in the sidecar entrypoint or in a `RUN` step, then delete the generator from the `main` image (`ultracode-auth-audit` removes `/tmp/generate.mjs` after seed).
- Bind sidecar HTTP on `0.0.0.0`, not `127.0.0.1`.
- Fresh compose stack per Harbor trial is the isolation method.
- Treatment needs `network_mode = "public"` so `world` can POST wait-token URLs. Cloud `deploy` cannot reach `world:4747`.
- Volume mount hides image files under `/app`. The Trigger sidecar copies `/opt/seed` onto the volume, then `exec trigger dev`.
- One secret: `TRIGGER_SECRET_KEY`. Compose maps `TRIGGER_ACCESS_TOKEN` from it. `TRIGGER_PROJECT_REF` goes in `trigger.config.ts`.

## Verification guidance

- Verifier copies `tests/` to `/tests` after the agent. `test.sh` must always write `/logs/verifier/reward.txt`.
- Independent truth is the sidecar ledger plus `tests/fixtures/oracle.json`, not `report.json` alone.
- Do not put `VERIFIER_TOKEN` in `[environment.env]` (agent-visible).
- Treatment: `grade.mjs --require-trigger`. Control must not pass that flag.

## Run and audit guidance

```bash
harbor run -p tasks/release-train/control -a oracle -e docker -n 1 -y
harbor run -p tasks/ultracode-auth-audit -a oracle -e docker -n 1 -y
# treatment: no Oracle solution yet; needs --env-file .env
```

Jobs belong under `jobs/` (gitignored). Do not start scored model trials without an explicit run plan.

## Existing Task coverage

| Task | Condition |
|---|---|
| [release-train](../../../tasks/release-train/Task.md) | Family spec: control vs treatment |
| [ultracode-auth-audit](../../../tasks/ultracode-auth-audit/Task.md) | Fan-out auth audit + exactly-once tickets + flaky CI |

## Known limits and open questions

- Harbor Oracle path does not inject SIGKILL/sleep faults; those remain operator-driven.
- Cloud Harbor backends that cannot run compose will not hide the world oracle; Dockerfile-only packing would leak `/hidden` into `main`.
- Treatment has no `solution/solve.sh`. Control Oracle passed `PROFILE=smoke` before the two-arm split.
- World skill has not been human-reviewed.

## Update this skill

Keep Task-specific expected results in `tasks/release-train/Task.md`. Add a rule here only after a second Task reuses it.
