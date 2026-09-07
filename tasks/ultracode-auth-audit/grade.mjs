#!/usr/bin/env node
/**
 * Compare the agent's report + tracker ledger against the hidden oracle.
 *
 *   node grade.mjs --report /path/to/report.json
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const oracle = JSON.parse(readFileSync(join(root, "grader/oracle.json"), "utf8"));
const ledgerPath = join(root, "grader/ledger.jsonl");
const reportPath = process.argv.includes("--report")
  ? process.argv[process.argv.indexOf("--report") + 1]
  : join(root, "workspace/report.json");

function loadJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadLedger() {
  if (!existsSync(ledgerPath)) return [];
  return readFileSync(ledgerPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
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

const out = {
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
  ciMarkerPresent: existsSync(join(root, "workspace/.ci-attempt")),
};

console.log(JSON.stringify(out, null, 2));

const pass =
  recall === 1 &&
  precision === 1 &&
  ticketsForPlanted === planted.size &&
  duplicateTickets === 0 &&
  extraTickets === 0;

process.exit(pass ? 0 : 1);
