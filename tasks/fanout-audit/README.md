# fanout-audit

Same planted auth-audit. Two Harbor arms.

| Arm | Path | What the agent does |
|---|---|---|
| Control | `control/` | Stays in session; may spawn subagents / write a Claude workflow script |
| Treatment | `treatment/` | Writes a Trigger.dev parent + model child tasks; sidecar runs them |

Human spec: [`Task.md`](Task.md). Do not copy that file into either agent image.

```bash
harbor run -p tasks/fanout-audit/control -a oracle -e docker -n 1 -y
harbor run -p tasks/fanout-audit/treatment --env-file .env -e docker -n 1 -y
```

Smoke is 16 routes / 4 planted (`ROUTE_COUNT=16`, `PLANTED=4`). Treatment needs Trigger keys and `ANTHROPIC_API_KEY`.
