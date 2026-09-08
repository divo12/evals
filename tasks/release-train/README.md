# release-train

Same ACME-2026-0917 release. Two Harbor arms.

| Arm | Path | What the agent does |
|---|---|---|
| Control | `control/` | Ultracode authors a native Workflow; the session drives `world` |
| Treatment | `treatment/` | Writes a Trigger.dev workflow; sidecar `trigger-dev` runs it |

Human spec: [`Task.md`](Task.md). Do not copy that file into either agent image.

```bash
harbor run -p tasks/release-train/control -a oracle -e docker -n 1 -y
harbor run -p tasks/release-train/treatment -a oracle --env-file .env -e docker -n 1 -y
```

Control compose is `main` + `world`. Treatment adds `trigger-dev`. Same ledger
grader; treatment requires every CI/approval completion to match a successful
Trigger wait-token callback and rejects polling. This is a no-fault baseline.
