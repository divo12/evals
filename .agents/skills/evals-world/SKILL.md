---
name: evals-world
description: Use with eval-engineering when generating Task Specs or building Harbor Tasks for this Trigger.dev durable-agent evals repository. Unreviewed bootstrap.
---

# evals World Knowledge

Read `$eval-engineering` first. Use its broad references and examples as
guidance. Use this skill for reusable knowledge about how that guidance applies
to this project.

This skill is an **unreviewed** bootstrap created during the Harbor packaging
pass. Do not treat it as human-approved.

## Start here

- Read `README.md` for Harbor run commands.
- Existing Task Specs: `tasks/release-train/Task.md`, `tasks/ultracode-auth-audit/Task.md` (both Draft).
- Runnable Harbor tasks: `tasks/release-train/`, `tasks/ultracode-auth-audit/`.
- Pinned Harbor CLI: 0.22.0 (`harbor --version`).
- Layout follows ITSMBench (`instruction.md`, `task.toml`, `environment/Dockerfile` + `docker-compose.yaml` with a sidecar, `tests/test.sh` writing `/logs/verifier/reward.txt`, `solution/solve.sh`) plus eval-engineering `Task.md` beside the package.

## Knowledge routing

| Current need | Read or run | What it provides |
|---|---|---|
| Harbor package shape | `tasks/release-train/task.toml` | schema_version 1.4 example used in this repo |
| Sidecar world + shared workspace volume | `tasks/release-train/environment/docker-compose.yaml` | agent edits `/app`; world runs `check.mjs` on those files |
| Hidden oracle | `tests/fixtures/oracle.json` in each task | never COPY into the `main` image |
| Ledger grading | `GET /internal/ledger` with `[verifier.env].VERIFIER_TOKEN` | 404 without the bearer token |

## Task Spec guidance

Two families exist:

- **Durable release train** — long waits, exactly-once deploys, delayed approvals, canary rollback. Default Harbor profile is `smoke`. Product comparison uses `PROFILE=compressed` with a much larger `[agent].timeout_sec`.
- **Auth-audit fan-out** — planted missing `requireAuth`, tracker side effects, flaky CI. Default `CI_SECONDS=12`. Watchdog comparison uses 240+.

Do not store planted route lists or degrade-service names here.

## Environment guidance

- Primary compose service must be `main`. Sidecars use Docker network aliases (`world`, `tracker`).
- Generate agent-visible files in the sidecar entrypoint or in a `RUN` step, then delete the generator from the `main` image (`ultracode-auth-audit` removes `/tmp/generate.mjs` after seed).
- Bind sidecar HTTP on `0.0.0.0`, not `127.0.0.1`.
- Fresh compose stack per Harbor trial is the isolation method.

## Verification guidance

- Verifier copies `tests/` to `/tests` after the agent. `test.sh` must always write `/logs/verifier/reward.txt`.
- Independent truth is the sidecar ledger plus `tests/fixtures/oracle.json`, not `report.json` alone.
- Do not put `VERIFIER_TOKEN` in `[environment.env]` (agent-visible).

## Run and audit guidance

```bash
harbor run -p tasks/release-train -a oracle -e docker -n 1 -y
harbor run -p tasks/ultracode-auth-audit -a oracle -e docker -n 1 -y
```

Jobs belong under `jobs/` (gitignored). Do not start scored model trials without an explicit run plan.

## Existing Task coverage

| Task | Condition |
|---|---|
| [release-train](../../../tasks/release-train/Task.md) | Unattended gated release with canaries and timed follow-up |
| [ultracode-auth-audit](../../../tasks/ultracode-auth-audit/Task.md) | Fan-out auth audit + exactly-once tickets + flaky CI |

## Known limits and open questions

- Harbor Oracle path does not inject SIGKILL/sleep faults; those remain operator-driven.
- Cloud Harbor backends that cannot run compose will not hide the world oracle; Dockerfile-only packing would leak `/hidden` into `main`.
- World skill has not been human-reviewed. Harbor Oracle passed both tasks after packaging (`ultracode-auth-audit` reward 1; `release-train` reward 1 under `PROFILE=smoke`).

## Update this skill

Keep Task-specific expected results in each `Task.md`. Add a rule here only after a second Task reuses it.
