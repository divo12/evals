# release-train

Same ACME-2026-0917 release. Two Harbor arms.

| Arm | Path | What the agent does |
|---|---|---|
| Control | `control/` | Stays in the session and drives `world` itself |
| Treatment | `treatment/` | Writes a Trigger.dev workflow; sidecar `trigger-dev` runs it |

Human spec: [`Task.md`](Task.md). Do not copy that file into either agent image.

```bash
harbor run -p tasks/release-train/control -a oracle -e docker -n 1 -y
harbor run -p tasks/release-train/treatment -a oracle --env-file .env -e docker -n 1 -y
```

Control compose is `main` + `world`. Treatment adds `trigger-dev`. Same ledger grader; treatment also requires CI/approval callbacks to `*.trigger.dev`.
