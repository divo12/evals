# Auth audit on Trigger.dev

Audit every TypeScript route handler under `src/routes/` for missing
authentication checks. Authenticated business routes must wrap the handler in
`requireAuth`. Public exceptions that must NOT be flagged: `health`, `status`,
`openapi`, `login`, `signup`, `stripe-webhook`.

You must implement this as a Trigger.dev project. A worker is already running
`trigger dev` against `/app/orchestrator`. Do not start `trigger dev` yourself.
Do not run `trigger deploy`.

## Trigger.dev project

```
/app/orchestrator/trigger.config.ts     # already seeded; keep the project ref
/app/orchestrator/src/trigger/*.ts      # your tasks
```

`TRIGGER_SECRET_KEY`, `TRIGGER_ACCESS_TOKEN`, `TRIGGER_PROJECT_REF`,
`AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL`, and `AZURE_OPENAI_DEPLOYMENT`
are in the environment. The worker is already authenticated; do not run
`login`, `dev`, or `deploy`.

Call the model from inside a Trigger task the way Trigger.dev documents: Vercel
AI SDK `generateText` (or `AgentChat`) plus `@ai-sdk/azure`. Do not wrap Azure
in a custom HTTP helper.

```ts
import { generateText } from "ai";
import { createAzure } from "@ai-sdk/azure";

const azure = createAzure({
  apiKey: process.env.AZURE_OPENAI_API_KEY,
  baseURL: process.env.AZURE_OPENAI_BASE_URL,
});

await generateText({
  model: azure.chat(process.env.AZURE_OPENAI_DEPLOYMENT!),
  prompt: "...",
  experimental_telemetry: { isEnabled: true },
});
```

Write a parent task that lists the route files, then fans out with
`batchTriggerAndWait` (or `pipeline`-equivalent child triggers). Each child
task is a subagent: it must call a model (`generateText` or `AgentChat`) with
tools to read that one file and return `{ confirmed, route, reason }`. Do not
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
