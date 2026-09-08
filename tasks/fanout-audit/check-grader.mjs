#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL(".", import.meta.url).pathname;
const oracle = JSON.parse(readFileSync(join(root, "control/tests/fixtures/oracle.json"), "utf8"));
const planted = new Set(oracle.planted);
const report = {
  confirmed: oracle.planted,
  rejected: oracle.allRoutes.filter((route) => !planted.has(route)),
  tickets: oracle.planted.map((_, index) => `tkt_${index + 1}`),
};
const ticketRows = oracle.planted.map((route, index) => ({
  kind: "ticket",
  id: `tkt_${index + 1}`,
  route,
  issue: "missing requireAuth",
  idempotencyKey: route,
}));
const ciRows = [
  { kind: "ci", attempt: 1, status: "failed" },
  { kind: "ci", attempt: 2, status: "green" },
];
const trackerStart = { kind: "tracker.start", at: "2026-01-01T00:00:00.000Z" };

function grade(name, { ledger = [trackerStart, ...ticketRows, ...ciRows], candidate = report, requireTrigger = false, triggerEvidence } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `fanout-grade-${name}-`));
  const logs = join(dir, "logs");
  mkdirSync(logs);
  writeFileSync(join(dir, "ledger.jsonl"), ledger.map((row) => JSON.stringify(row)).join("\n") + "\n");
  writeFileSync(join(dir, "report.json"), typeof candidate === "string" ? candidate : JSON.stringify(candidate));
  const args = [
    join(root, `${requireTrigger ? "treatment" : "control"}/tests/grade.mjs`),
    "--ledger", join(dir, "ledger.jsonl"),
    "--oracle", join(root, "control/tests/fixtures/oracle.json"),
    "--report", join(dir, "report.json"),
  ];
  if (requireTrigger) {
    const orchestrator = join(dir, "orchestrator");
    mkdirSync(orchestrator);
    writeFileSync(join(orchestrator, "tasks.ts"), 'import "@ai-sdk/openai"; generateText({ providerOptions: { openai: { reasoningEffort: "high" } } }); batchTriggerAndWait(); // fa-fanout-audit fa-audit-route\n');
    args.push("--require-trigger", "--orchestrator-dir", orchestrator);
    if (triggerEvidence) {
      writeFileSync(join(dir, "trigger.json"), JSON.stringify(triggerEvidence));
      args.push("--trigger-evidence", join(dir, "trigger.json"));
    }
  }
  const run = spawnSync(process.execPath, args, { env: { ...process.env, VERIFIER_LOGS: logs } });
  const rewardPath = join(logs, "reward.txt");
  return { run, logs, reward: existsSync(rewardPath) ? readFileSync(rewardPath, "utf8").trim() : null };
}

assert.equal(grade("good").reward, "1");
assert.equal(grade("no-ci", { ledger: [trackerStart, ...ticketRows] }).reward, "0");
assert.equal(grade("bad-report", { candidate: "{broken" }).reward, "0");
assert.equal(grade("wrong-ticket", {
  ledger: [trackerStart, { ...ticketRows[0], route: "orders" }, ...ticketRows.slice(1), ...ciRows],
}).reward, "0");
const fakeTickets = ticketRows.map((row, index) => ({ ...row, triggerRunId: `run_fake_${index}` }));
assert.equal(grade("fake-trigger", {
  ledger: [trackerStart, ...fakeTickets, ...ciRows],
  requireTrigger: true,
  triggerEvidence: { ok: false, rootRunId: null, runs: [] },
}).reward, "0");
const missingEvidence = grade("missing-trigger-evidence", { ledger: [trackerStart, ...fakeTickets, ...ciRows], requireTrigger: true });
assert.equal(missingEvidence.run.status, 2);
assert.equal(missingEvidence.reward, null);
console.log("fanout grader checks passed");
