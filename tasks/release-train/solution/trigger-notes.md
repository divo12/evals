# Shape of a passing Trigger.dev arm

Not a solution — the agent has to write it. This is the checklist the operator uses to judge
whether Claude actually used the durable primitives or just wrapped a polling loop in a task.

```
workspace/orchestrator/
├── trigger.config.ts
└── src/trigger/
    ├── release-train.ts      parent: migrate → CI all → per batch (approval → canary → observe → promote/rollback) → follow-up
    ├── ci.ts                 child per service: POST /ci/run with callback = token.url, wait.forToken, retry on "infra:" flake
    ├── canary.ts             child per service: wait.for in slices, GET /metrics, rollback early or promote after window
    └── shared.ts             fetch helper, idempotency keys `${stage}:${service}`
```

Primitives that map 1:1 onto the world:

| World | Trigger.dev |
|---|---|
| CI / approval callbacks | `const token = await wait.createToken({ timeout: "2h" })`, pass `token.url` as `callback.url`, then `await wait.forToken(token)` |
| Canary window | `await wait.for({ minutes: 5 })` in a loop reading `/metrics`, or `wait.until({ date: observeUntil })` |
| Follow-up after last promotion | `await wait.until({ date: new Date(lastPromoteAt + followUp * 1000) })` |
| No duplicate deploys on retry/resume | `idempotencyKey` on the child `triggerAndWait` **and** on the `/deploy` body |
| One batch at a time, many services in parallel | `batch.triggerAndWait` for CI and canary children |
| Faults (SIGKILL worker / laptop sleep) | On cloud: checkpoint/resume; on `trigger dev`, the CLI reconnects and the run resumes at the wait |

Things that would make the Trigger arm fail the same way as the Claude arm — watch for them:

- Polling `/ci/run/:id` in a tight `while` loop instead of `wait.forToken` (works, but `polls.ci` in results.json shows it, and a killed worker mid-poll loses the loop).
- Computing `lastPromoteAt` from `Date.now()` inside a task that gets retried.
- Random idempotency keys.
- `wait.for` shorter than the flake window with no retry wrapper.

Chosen arm: sidecar `trigger-dev` + cloud keys. The sidecar seeds `/app/orchestrator` and runs `trigger dev`. Waits live on `api.trigger.dev`; the worker stays on the compose net and calls `world:4747`. `world` POSTs public `wait.forToken` URLs. Keys go in repo-root `.env`. Do not run `dev` inside `main`. Do not `deploy` (worker would leave the compose net).
