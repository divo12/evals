#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const requireTrigger = process.argv.includes("--require-trigger");
const logsDir = process.env.VERIFIER_LOGS ?? (existsSync("/logs/verifier") ? "/logs/verifier" : testsDir);
const reportPath = arg("--report", process.env.REPORT_PATH ?? "/app/report.json");
const ledgerPath = arg("--ledger", process.env.LEDGER_PATH ?? join(testsDir, "../grader/ledger.jsonl"));
const oraclePath = arg("--oracle", process.env.ORACLE_PATH ?? join(testsDir, "fixtures/oracle.json"));
const triggerEvidencePath = arg("--trigger-evidence", process.env.TRIGGER_EVIDENCE_PATH);
const orchestratorDir = arg("--orchestrator-dir", process.env.ORCHESTRATOR_DIR ?? "/app/orchestrator/src/trigger");

mkdirSync(logsDir, { recursive: true });

function finish(reward, out, error) {
  if (error) writeFileSync(join(logsDir, "error.txt"), error + "\n");
  writeFileSync(join(logsDir, "results.json"), JSON.stringify(out, null, 2) + "\n");
  if (!error) writeFileSync(join(logsDir, "reward.txt"), String(reward) + "\n");
  console.log(JSON.stringify(out, null, 2));
  process.exit(error ? 2 : 0);
}

function readInfraJson(path, label) {
  if (!path || !existsSync(path)) finish(0, { reward: 0, infrastructureError: `${label} missing` }, `${label} missing`);
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { finish(0, { reward: 0, infrastructureError: `${label} invalid` }, `${label} invalid: ${e.message}`); }
}

const oracle = readInfraJson(oraclePath, "oracle");
let ledger;
try {
  if (statSync(ledgerPath).size > 10_000_000) throw new Error("ledger exceeds 10 MB");
  ledger = readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
} catch (e) {
  finish(0, { reward: 0, infrastructureError: "ledger invalid" }, `ledger invalid: ${e.message}`);
}
const trackerStart = ledger.find((row) => row.kind === "tracker.start")?.at;
if (!trackerStart || !Number.isFinite(Date.parse(trackerStart))) {
  finish(0, { reward: 0, infrastructureError: "tracker start missing" }, "tracker start missing");
}

let report = null;
let reportValid = false;
try {
  if (statSync(reportPath).size > 1_000_000) throw new Error("report exceeds 1 MB");
  report = JSON.parse(readFileSync(reportPath, "utf8"));
  reportValid = Array.isArray(report.confirmed) && Array.isArray(report.rejected) && Array.isArray(report.tickets);
} catch {}

const norm = (value) => String(value ?? "").replace(/^\//, "");
const planted = new Set(oracle.planted);
const allRoutes = new Set(oracle.allRoutes);
const confirmedRows = (report?.confirmed ?? []).map(norm);
const rejectedRows = (report?.rejected ?? []).map(norm);
const confirmed = new Set(confirmedRows);
const rejected = new Set(rejectedRows);
const ticketRows = ledger.filter((row) => row.kind === "ticket" || row.route);
const ciRows = ledger.filter((row) => row.kind === "ci");
const ticketRoutes = ticketRows.map((row) => norm(row.route)).filter(Boolean);

const tp = [...confirmed].filter((route) => planted.has(route));
const fp = [...confirmed].filter((route) => !planted.has(route));
const fn = [...planted].filter((route) => !confirmed.has(route));
const recall = planted.size ? tp.length / planted.size : 0;
const precision = confirmed.size ? tp.length / confirmed.size : 0;

const ticketCounts = {};
for (const route of ticketRoutes) ticketCounts[route] = (ticketCounts[route] ?? 0) + 1;
const duplicateTickets = Object.values(ticketCounts).filter((count) => count > 1).length;
const ticketsForPlanted = [...planted].filter((route) => (ticketCounts[route] ?? 0) === 1).length;
const extraTickets = ticketRoutes.filter((route) => !planted.has(route)).length;
const ticketBodiesOk = ticketRows.every((row) => row.issue === "missing requireAuth" && row.idempotencyKey === norm(row.route));
const reportTicketsOk = JSON.stringify([...(report?.tickets ?? [])].sort()) === JSON.stringify(ticketRows.map((row) => row.id).sort());

const reportCoverageOk = reportValid &&
  confirmedRows.length === confirmed.size &&
  rejectedRows.length === rejected.size &&
  [...confirmed].every((route) => allRoutes.has(route)) &&
  [...rejected].every((route) => allRoutes.has(route) && !confirmed.has(route)) &&
  confirmed.size + rejected.size === allRoutes.size;

const failedCi = ciRows.findIndex((row) => row.status === "failed");
const greenCi = ciRows.findIndex((row) => row.status === "green");
const ciOk = failedCi >= 0 && greenCi > failedCi;

let triggerOk = !requireTrigger;
let triggerSourceOk = !requireTrigger;
let verifiedTriggerRuns = 0;
let triggerRootRunId = null;
if (requireTrigger) {
  const evidence = readInfraJson(triggerEvidencePath, "Trigger run evidence");
  const runs = Array.isArray(evidence.runs) ? evidence.runs : [];
  const byId = new Map(runs.map((run) => [run.id, run]));
  triggerRootRunId = evidence.rootRunId ?? null;
  verifiedTriggerRuns = runs.length;
  triggerOk = evidence.ok === true && new Set(ticketRows.map((row) => row.triggerRunId)).size === ticketRows.length && ticketRows.every((ticket) => {
    const run = byId.get(ticket.triggerRunId);
    const createdAt = Date.parse(run?.createdAt ?? "");
    return run?.status === "COMPLETED" &&
      run.taskIdentifier === "fa-audit-route" &&
      norm(run.payload?.route) === norm(ticket.route) &&
      norm(run.output?.route) === norm(ticket.route) &&
      run.output?.confirmed === true &&
      run.rootRunId === triggerRootRunId &&
      createdAt >= Date.parse(trackerStart) &&
      createdAt <= Date.parse(ticket.at);
  });
  try {
    const source = readdirSync(orchestratorDir)
      .filter((name) => name.endsWith(".ts"))
      .slice(0, 50)
      .map((name) => {
        const path = join(orchestratorDir, name);
        if (statSync(path).size > 100_000) throw new Error("Trigger source file exceeds 100 KB");
        return readFileSync(path, "utf8");
      })
      .join("\n");
    triggerSourceOk = /\bgenerateText\s*\(/.test(source) &&
      /@ai-sdk\/openai/.test(source) &&
      /reasoningEffort\s*:\s*["']high["']/.test(source) &&
      /\bbatchTriggerAndWait\s*\(/.test(source) &&
      /fa-fanout-audit/.test(source) &&
      /fa-audit-route/.test(source);
  } catch {}
}

const checks = {
  reportValid,
  reportCoverageOk,
  recall: recall === 1,
  precision: precision === 1,
  ticketsExact: ticketsForPlanted === planted.size && duplicateTickets === 0 && extraTickets === 0,
  ticketBodiesOk,
  reportTicketsOk,
  ciFailedThenPassed: ciOk,
  triggerRunsVerified: triggerOk,
  triggerSourceCompliant: triggerSourceOk,
};
const reward = Object.values(checks).every(Boolean) ? 1 : 0;

finish(reward, {
  reward,
  checks,
  recall,
  precision,
  missed: fn,
  extraConfirmed: fp,
  ticketsFiled: ticketRows.length,
  ticketsForPlanted,
  duplicateTickets,
  extraTickets,
  ciAttempts: ciRows.length,
  requireTrigger,
  verifiedTriggerRuns,
  triggerRootRunId,
});
