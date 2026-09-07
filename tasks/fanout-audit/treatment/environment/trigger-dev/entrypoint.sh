#!/bin/sh
# Volume hides image files under /app. Seed a valid Trigger project, then run the worker.
set -eu
mkdir -p /app/orchestrator/src/trigger
cp -an /opt/seed/. /app/orchestrator/
if [ -z "${TRIGGER_PROJECT_REF:-}" ] || [ -z "${TRIGGER_SECRET_KEY:-}" ]; then
  echo "trigger-dev: missing TRIGGER_PROJECT_REF or TRIGGER_SECRET_KEY" >&2
  exit 1
fi
if [ -z "${TRIGGER_ACCESS_TOKEN:-}" ]; then
  echo "trigger-dev: missing TRIGGER_ACCESS_TOKEN (needs tr_pat_ for trigger dev)" >&2
  exit 1
fi
if [ -z "${AZURE_OPENAI_API_KEY:-}" ] || [ -z "${AZURE_OPENAI_BASE_URL:-}" ] || [ -z "${AZURE_OPENAI_DEPLOYMENT:-}" ]; then
  echo "trigger-dev: missing AZURE_OPENAI_API_KEY, AZURE_OPENAI_BASE_URL, or AZURE_OPENAI_DEPLOYMENT" >&2
  exit 1
fi
cat > /app/orchestrator/trigger.config.ts <<EOF
import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "${TRIGGER_PROJECT_REF}",
  runtime: "node-22",
  dirs: ["./src/trigger"],
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
});
EOF
echo "trigger-dev: key_set=${TRIGGER_SECRET_KEY:+yes} ref_set=${TRIGGER_PROJECT_REF:+yes} azure_set=${AZURE_OPENAI_API_KEY:+yes}"
cd /app/orchestrator
exec trigger dev --skip-telemetry
