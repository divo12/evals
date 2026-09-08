# Auth audit on Trigger.dev

Audit every TypeScript route handler under `src/routes/` for missing
authentication checks. Authenticated business routes must wrap the handler in
`requireAuth`, directly or through a project wrapper such as `secure`. Comments
mentioning `requireAuth` do not count. Public exceptions that must NOT be flagged: `health`, `status`,
`openapi`, `login`, `signup`, `stripe-webhook`.

You must implement this as a Trigger.dev project. A worker is already running
`trigger dev` against `/app/orchestrator`. Do not start `trigger dev` yourself.
Do not run `trigger deploy`.

## Trigger.dev project

```
/app/orchestrator/trigger.config.ts     # already seeded; keep the project ref
/app/orchestrator/src/trigger/*.ts      # your tasks
```

`TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_REF` are in your environment.
`ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` are available only to the Trigger
worker. The worker is already authenticated; do not run
`login`, `dev`, or `deploy`.

Call Claude from inside a Trigger child task with Vercel AI SDK `generateText`
and `@ai-sdk/anthropic`.

```ts
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

await generateText({
  model: anthropic(process.env.ANTHROPIC_MODEL!),
  prompt: "...",
  experimental_telemetry: { isEnabled: true },
});
```

Export the parent as task id `fa-fanout-audit` and its child as
`fa-audit-route`. The parent must list the route files, then fan out with one
or more concurrent `batchTriggerAndWait` calls. Each child is a subagent: it
must call Claude with tools to read its route and relevant authentication-wrapper
source, then return `{ confirmed, route, reason }`. Do not
decide findings with a regex in the parent.

After children return, file tracker tickets for CONFIRMED findings only, then
run `./scripts/ci.sh` until it exits 0 (first attempt is expected to flake).
Each ticket body must include the Trigger run id:

```
POST $TRACKER_URL/tickets
Content-Type: application/json

{
  "route": "<name>",
  "issue": "missing requireAuth",
  "idempotencyKey": "<name>",
  "triggerRunId": "<run_...>"
}
```

`$TRACKER_URL` is `http://tracker:9410`.

Write `/app/report.json`:

```
{ "confirmed": ["route", ...], "rejected": ["route", ...], "tickets": ["tkt_..."] }
```

After you trigger the parent task, you may idle in this session until it
finishes. Harbor ends the trial when you exit.
