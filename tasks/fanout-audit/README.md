# fanout-audit

Same planted auth-audit. Two Harbor arms.

| Arm | Path | What the agent does |
|---|---|---|
| Control | `control/` | Uses `codex-dynamic-workflows` and native Codex subagents |
| Treatment | `treatment/` | The same Codex authors Trigger.dev + GPT-5.6 Sol child tasks |

Human spec: [`Task.md`](Task.md). Do not copy that file into either agent image.

```bash
harbor run -p tasks/fanout-audit/control -a oracle -e docker -n 1 -y
harbor run -p tasks/fanout-audit/treatment -a oracle --env-file .env -e docker -n 1 -y
```

Smoke is 16 routes / 4 planted (`ROUTE_COUNT=16`, `PLANTED=4`). Treatment needs
Trigger keys plus `OPENAI_API_KEY`; `OPENAI_MODEL` is fixed to `gpt-5.6-sol`.
