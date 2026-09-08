# release-train

Same ACME-2026-0917 release. Two Harbor arms.

| Arm | Path | What the agent does |
|---|---|---|
| Control | `control/` | Uses `codex-dynamic-workflows`; the Codex session drives `world` |
| Treatment | `treatment/` | The same Codex uses `trigger-authoring-tasks`; sidecar runs it |

Human spec: [`Task.md`](Task.md). Do not copy that file into either agent image.

```bash
harbor run -p tasks/release-train/control -a oracle -e docker -n 1 -y
harbor run -p tasks/release-train/treatment -a oracle --env-file .env -e docker -n 1 -y
```

Control compose is `main` + `world`. Treatment adds `trigger-dev`. Same ledger
grader; treatment requires every CI/approval completion to match a successful
Trigger wait-token callback and rejects polling. This is a no-fault baseline.

Use `scripts/run-codex-pair.sh release-train .env` from the repository root.
