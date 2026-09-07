# ultracode-auth-audit

Harbor task. See `Task.md` (Draft) and `instruction.md`.

```bash
harbor run -p tasks/ultracode-auth-audit -a oracle -e docker -n 1 -y
```

Compose services: `main` (generated API at `/app`) and `tracker` (ticket ledger). Generator is deleted from the agent image after seed. Hidden planted list is `tests/fixtures/oracle.json`.

`CI_SECONDS` defaults to 12 for Harbor Oracle. Set 240+ to stress stall watchdogs.
