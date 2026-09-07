#!/bin/sh
# Volume hides image files under /app. Seed the project, then run the worker.
set -eu
mkdir -p /app/orchestrator/src/trigger
cp -an /opt/seed/. /app/orchestrator/
if [ ! -f /app/orchestrator/trigger.config.ts ]; then
  printf 'export default { project: "%s", dirs: ["./src/trigger"] };\n' \
    "${TRIGGER_PROJECT_REF:-proj_smoke}" > /app/orchestrator/trigger.config.ts
fi
cd /app/orchestrator
exec trigger dev --skip-telemetry
