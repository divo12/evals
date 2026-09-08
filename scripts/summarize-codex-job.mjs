#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const job = process.argv[2];
if (!job || !existsSync(join(job, "result.json"))) {
  console.error("usage: node scripts/summarize-codex-job.mjs <jobs/job-name>");
  process.exit(2);
}

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

const rollouts = filesUnder(job).filter((path) => /\/agent\/sessions\/.*\/rollout-.*\.jsonl$/.test(path));
const totals = { input: 0, cached: 0, output: 0 };

for (const rollout of rollouts) {
  let usage;
  for (const line of readFileSync(rollout, "utf8").split("\n")) {
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const candidate = event.type === "event_msg" && event.payload?.type === "token_count"
      ? event.payload.info?.total_token_usage
      : undefined;
    if (candidate) usage = candidate;
  }
  if (!usage) continue;
  totals.input += usage.input_tokens ?? 0;
  totals.cached += usage.cached_input_tokens ?? 0;
  totals.output += usage.output_tokens ?? 0;
}

if (!totals.input && !totals.output) {
  console.error("no readable Codex token totals found");
  process.exit(1);
}

const result = JSON.parse(readFileSync(join(job, "result.json"), "utf8"));
// GPT-5.6 Sol standard API rates on 2026-09-08. Recheck before later studies.
const rates = { input: 4, cached: 0.4, output: 20 };
const estimatedCostUsd =
  ((totals.input - totals.cached) * rates.input + totals.cached * rates.cached + totals.output * rates.output) / 1_000_000;

console.log(JSON.stringify({
  job,
  sessions: rollouts.length,
  inputTokens: totals.input,
  cachedInputTokens: totals.cached,
  outputTokens: totals.output,
  estimatedCostUsd,
  pricingPerMillionUsd: rates,
  harborReportedCostUsd: result.stats?.cost_usd ?? null,
}, null, 2));
