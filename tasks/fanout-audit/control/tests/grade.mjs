#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

mkdirSync(logsDir, { recursive: true });

function failInfra(msg) {
  writeFileSync(join(logsDir, "error.txt"), msg + "\n");
  writeFileSync(join(logsDir, "reward.txt"), "0\n");
  console.error(msg);
  process.exit(2);
}

if (!existsSync(oraclePath)) failInfra(`oracle missing at ${oraclePath}`);
const oracle = JSON.parse(readFileSync(oraclePath, "utf8"));

function loadJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadLedger() {
  if (!existsSync(ledgerPath)) return [];
  return readFileSync(ledgerPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

const planted = new Set(oracle.planted);
const report = loadJson(reportPath);
const ledger = loadLedger();
const confirmed = new Set((report?.confirmed ?? []).map((x) => String(x).replace(/^\//, "")));
const ticketRoutes = ledger.map((r) => String(r.route ?? "").replace(/^\//, "")).filter(Boolean);

const tp = [...confirmed].filter((r) => planted.has(r));
const fp = [...confirmed].filter((r) => !planted.has(r));
const fn = [...planted].filter((r) => !confirmed.has(r));
const recall = planted.size ? tp.length / planted.size : 0;
const precision = confirmed.size ? tp.length / confirmed.size : 0;

const ticketCounts = {};
for (const r of ticketRoutes) ticketCounts[r] = (ticketCounts[r] ?? 0) + 1;
const duplicateTickets = Object.values(ticketCounts).filter((n) => n > 1).length;
const ticketsForPlanted = [...planted].filter((r) => (ticketCounts[r] ?? 0) >= 1).length;
const extraTickets = ticketRoutes.filter((r) => !planted.has(r)).length;

const triggerTickets = ledger.filter((r) => /^run_/.test(String(r.triggerRunId ?? "")));
const triggerOk = !requireTrigger || (
  triggerTickets.length > 0 &&
  ledger.every((r) => /^run_/.test(String(r.triggerRunId ?? "")))
);

const reward =
  recall === 1 &&
  precision === 1 &&
  ticketsForPlanted === planted.size &&
  duplicateTickets === 0 &&
  extraTickets === 0 &&
  triggerOk
    ? 1
    : 0;

const out = {
  reward,
  recall,
  precision,
  truePositives: tp.length,
  falsePositives: fp.length,
  falseNegatives: fn.length,
  missed: fn,
  extraConfirmed: fp,
  ticketsFiled: ledger.length,
  ticketsForPlanted,
  duplicateTickets,
  extraTickets,
  requireTrigger,
  triggerRunTickets: triggerTickets.length,
  ciMarkerPresent: existsSync("/app/.ci-attempt"),
};

writeFileSync(join(logsDir, "results.json"), JSON.stringify(out, null, 2) + "\n");
writeFileSync(join(logsDir, "reward.txt"), String(reward) + "\n");

console.log(JSON.stringify(out, null, 2));
process.exit(0);
