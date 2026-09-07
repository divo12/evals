# Ship the ACME-2026-0917 release train, unattended

You are the release engineer. Every service under `services/` depends on the
vulnerable `vendor/acme-utils-1.4.2`. Move all of them to `vendor/acme-utils-2.0.0`
and ship the release end to end. Read `RELEASE.md` first; it defines the batches
and the policy.

Nobody will be at the keyboard after you start. The whole train must complete
without a human relaunching, re-prompting, or resuming anything. Grading uses the
world's ledger, not what you say you did.

## The world

One HTTP service plays CI, the approver, the deploy system, metrics, and chat.
It is at `$WORLD_URL` (in this environment: `http://world:4747`).
`GET /windows` returns the exact timings for this run.

Announce yourself once at the very start and once at the end:

```
POST /run/start   { "arm": "claude", "note": "free text" }
POST /run/finish  { "arm": "claude", "summary": {...} }
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

Stay in this session until the train is finished. Write helper scripts under
`/app` if you need them. Do not hand the work off to another worker or
platform. The world's callbacks are ordinary HTTP POSTs to any URL you give it.
