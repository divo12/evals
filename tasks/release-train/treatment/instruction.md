# Ship the ACME-2026-0917 release train with Trigger.dev

You are the release engineer. Every service under `services/` depends on the
vulnerable `vendor/acme-utils-1.4.2`. Move all of them to `vendor/acme-utils-2.0.0`
and ship the release end to end. Read `RELEASE.md` first; it defines the batches
and the policy.

You must implement the train as a Trigger.dev project. A worker is already
running `trigger dev` against `/app/orchestrator`. Do not start `trigger dev`
yourself. Do not run `trigger deploy`.

Nobody will be at the keyboard after you start. The whole train must complete
without a human relaunching, re-prompting, or resuming anything. Grading uses the
world's ledger, not what you say you did.

## Trigger.dev project

Write the workflow under `/app/orchestrator`:

```
/app/orchestrator/trigger.config.ts     # already seeded; keep the project ref
/app/orchestrator/src/trigger/*.ts      # your tasks
```

`TRIGGER_SECRET_KEY`, `TRIGGER_ACCESS_TOKEN`, and `TRIGGER_PROJECT_REF` are already
in the environment. Use them from the Trigger.dev project on the shared volume.
The worker is already authenticated; do not run `login`, `dev`, or `deploy`.

For CI and approvals, create a wait token and pass `token.url` as `callback.url`.
Then `await wait.forToken(token).unwrap()`. Do not busy-poll `GET /ci/run/:id` or
`GET /approvals/:id`. For the canary window and the follow-up delay, use
`wait.for` or `wait.until`.

Keep CI, approvals, and deploys in the parent task. Do not `batchTriggerAndWait`
child tasks for this train — on `trigger dev` those children often fail with
`COULD_NOT_FIND_EXECUTOR`. Set `retry: { maxAttempts: 1 }` on the parent.
A Trigger retry after `POST /run/start` counts as a human relaunch.

After you write or change files under `/app/orchestrator/src/trigger`, wait
until the sidecar has indexed a new worker version before you trigger a run.
If a run sits in `PENDING_VERSION` or fails with `COULD_NOT_FIND_EXECUTOR`,
wait and trigger again — that means the local executor was still swapping.
Do not start a second train after `/run/start` has already been posted.

After you trigger the workflow, you may idle in this session until the train
finishes. Harbor ends the trial when you exit.

## The world

One HTTP service plays CI, the approver, the deploy system, metrics, and chat.
It is at `$WORLD_URL` (in this environment: `http://world:4747`).
`GET /windows` returns the exact timings for this run.

Announce yourself once at the very start and once at the end:

```
POST /run/start   { "arm": "trigger", "note": "free text" }
POST /run/finish  { "arm": "trigger", "summary": {...} }
```

Every additional `POST /run/start` is a human relaunch and fails the task.

### CI

```
POST /ci/run          { "service": "billing", "callback": { "url": "...", "headers": {...} } }   -> 202 { runId, etaSeconds }
GET  /ci/run/:runId                                                                           -> { status: running|green|failed, detail }
```

CI executes `services/<name>/check.mjs` after the CI window, then checks that
`deps.json` declares `"acme-utils": "2.0.0"`. `callback` is optional; if given,
the world POSTs `{ event: "ci.finished", runId, service, status, version, detail }`
when the run ends. Some runners are flaky and fail once for infrastructure
reasons; the detail says so. Re-run them.

### Approvals

```
POST /approvals/request  { "batch": "batch-1", "services": [...all services in that batch...], "callback": {...} } -> 202 { approvalId }
GET  /approvals/:approvalId                                                                                     -> { status: pending|approved, token }
```

The approver only accepts a batch once every service in it is CI-green at 2.0.0.
The decision arrives after a delay that is different for every batch (see
`/windows`). The callback body is `{ event: "approval.decided", approvalId, batch, status, token }`.
The `token` is required to canary any service in that batch.

### Deploys

```
POST /deploy  { "service": "billing", "stage": "canary",   "version": "2.0.0", "approvalToken": "apt_...", "idempotencyKey": "..." }
POST /deploy  { "service": "billing", "stage": "promote",  "idempotencyKey": "..." }
POST /deploy  { "service": "billing", "stage": "rollback", "idempotencyKey": "..." }
```

Deploys are real side effects. Without an `idempotencyKey` a repeated call deploys twice.
`promote` is rejected until the canary window has fully elapsed. `rollback` is allowed any time after a canary.

### Metrics and state

```
GET /metrics/:service    -> { errorRate, version, canary }
GET /services/:service   -> { version, batch, ciGreen, canaryAt, promotedAt, rolledBackAt }
```

During the canary window some services will start failing. If a canary's
`errorRate` goes above 0.05 it must be rolled back promptly and must never be promoted.

### Chat

```
POST /notify  { "channel": "releases", "text": "...", "data": { "patched": [...], "rolledBack": [...] } }
```

## What must be true at the end

1. Every service's `index.js` and `deps.json` moved to 2.0.0 with call sites fixed (see `vendor/acme-utils-2.0.0/MIGRATION.md`) and CI green.
2. Each batch requested for approval exactly once; canaries only after approval.
3. Each service canaried exactly once. Healthy services promoted exactly once after the full canary window. Degraded services rolled back exactly once and never promoted.
4. Every deploy carries an `idempotencyKey`. No duplicate effects.
5. Exactly the follow-up window after the **last promotion**, re-read every service's state and post exactly one message to `releases` with `data.patched` and `data.rolledBack` listing service names. Not earlier, not twice.
6. Zero human relaunches.
7. CI and approval completions arrived through Trigger wait-token callback URLs, not a polling loop in this session.
