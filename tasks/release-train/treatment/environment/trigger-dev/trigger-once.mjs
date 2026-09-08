#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const taskId = process.argv[2];
const secret = process.env.TRIGGER_SECRET_KEY;
const root = "/app/orchestrator";
if (!taskId || !secret) {
  console.error("usage: node trigger-once.mjs <task-id>; TRIGGER_SECRET_KEY is required");
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sourceDir = join(root, "src/trigger");
const sourceTime = Math.max(...readdirSync(sourceDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => statSync(join(sourceDir, name)).mtimeMs));

let indexed = false;
for (let attempt = 0; attempt < 90 && !indexed; attempt++) {
  const temp = join(root, ".trigger/tmp");
  if (existsSync(temp)) {
    for (const dir of readdirSync(temp)) {
      const index = join(temp, dir, "index.json");
      if (!existsSync(index) || statSync(index).mtimeMs + 1000 < sourceTime) continue;
      try {
        const manifest = JSON.parse(readFileSync(index, "utf8"));
        indexed = manifest.tasks?.some((task) => task.id === taskId) ?? false;
      } catch {}
      if (indexed) break;
    }
  }
  if (!indexed) await sleep(2000);
}
if (!indexed) {
  console.error(`worker did not index ${taskId}`);
  process.exit(1);
}

let handle;
for (let attempt = 0; attempt < 30; attempt++) {
  const response = await fetch(`https://api.trigger.dev/api/v1/tasks/${encodeURIComponent(taskId)}/trigger`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ payload: {} }),
  });
  if (response.ok) {
    handle = await response.json();
    break;
  }
  if (response.status !== 404 && response.status !== 409) {
    console.error(`trigger ${taskId}: HTTP ${response.status}`);
    process.exit(1);
  }
  await sleep(2000);
}

const runId = handle?.id ?? handle?.runId;
if (!/^run_/.test(String(runId))) {
  console.error(`trigger ${taskId}: response missing run id`);
  process.exit(1);
}

writeFileSync("/app/trigger-run.json", JSON.stringify({ runId, taskId }, null, 2) + "\n");
console.log(`triggered ${taskId} ${runId}; exit now`);
