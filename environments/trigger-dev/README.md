# trigger-dev sidecar

Cloud holds waits. This container runs `trigger dev` on a seeded `/app/orchestrator`
so the worker survives a dead Harbor agent and can still call `world:4747`.

Image lives in `tasks/release-train/environment/trigger-dev/`.
Put `TRIGGER_SECRET_KEY` and `TRIGGER_PROJECT_REF` in repo-root `.env`.

```bash
docker compose -f environments/trigger-dev/docker-compose.sidecar.yaml up --build
# kill fake-agent; trigger-dev stays up
```
