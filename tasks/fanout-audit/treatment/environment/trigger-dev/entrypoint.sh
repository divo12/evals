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
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  export ANTHROPIC_API_KEY="$CLAUDE_CODE_OAUTH_TOKEN"
fi
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "trigger-dev: missing ANTHROPIC_API_KEY (or CLAUDE_CODE_OAUTH_TOKEN)" >&2
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
echo "trigger-dev: key_set=${TRIGGER_SECRET_KEY:+yes} ref_set=${TRIGGER_PROJECT_REF:+yes} model_key_set=${ANTHROPIC_API_KEY:+yes}"
cd /app/orchestrator
exec trigger dev --skip-telemetry
