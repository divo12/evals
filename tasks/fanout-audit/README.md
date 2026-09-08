# fanout-audit

Same planted auth-audit. Two Harbor arms.

| Arm | Path | What the agent does |
|---|---|---|
| Control | `control/` | Runs a native Claude Code Workflow in the session |
| Treatment | `treatment/` | Writes a Trigger.dev parent + Claude child tasks; sidecar runs them |

Human spec: [`Task.md`](Task.md). Do not copy that file into either agent image.

```bash
harbor run -p tasks/fanout-audit/control -a oracle -e docker -n 1 -y
harbor run -p tasks/fanout-audit/treatment -a oracle --env-file .env -e docker -n 1 -y
```

Smoke is 16 routes / 4 planted (`ROUTE_COUNT=16`, `PLANTED=4`). Treatment needs
Trigger keys plus `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`. The model must
match the Claude release used by control Workflow children.
