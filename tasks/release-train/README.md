# release-train

Harbor task. See `Task.md` (Draft) and `instruction.md`.

```bash
harbor run -p tasks/release-train -a oracle -e docker -n 1 -y
```

Compose services: `main` (agent workspace `/app`) and `world` (CI, approvals, deploy, metrics, chat). Shared volume so CI runs the agent's files. Oracle and ledger stay on the world container.
