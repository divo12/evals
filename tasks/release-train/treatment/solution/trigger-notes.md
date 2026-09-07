# Shape of a passing Trigger.dev arm

Not a solution — the agent has to write it. Operator checklist only.

```
/app/orchestrator/
├── trigger.config.ts
└── src/trigger/
    ├── release-train.ts
    ├── ci.ts
    ├── canary.ts
    └── shared.ts
```

| World | Trigger.dev |
|---|---|
| CI / approval callbacks | `wait.createToken` + pass `token.url` + `wait.forToken` |
| Canary window | `wait.for` / `wait.until` plus `GET /metrics` |
| Follow-up | `wait.until` after last promotion |
| No duplicate deploys | `idempotencyKey` on children and `/deploy` |

Sidecar `trigger-dev` + cloud keys. Do not run `dev` inside `main`. Do not `deploy`.
