#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const [ledgerPath, outputPath] = process.argv.slice(2);
const secret = process.env.TRIGGER_SECRET_KEY;
if (!ledgerPath || !outputPath || !secret) throw new Error("ledger path, output path, and TRIGGER_SECRET_KEY are required");

const tickets = readFileSync(ledgerPath, "utf8")
  .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  .filter((row) => row.kind === "ticket" || row.route);
const ids = [...new Set(tickets.map((row) => row.triggerRunId).filter(Boolean))];
const headers = { authorization: `Bearer ${secret}`, accept: "application/json" };
const runs = [];

for (const id of ids) {
  const response = await fetch(`https://api.trigger.dev/api/v3/runs/${encodeURIComponent(id)}`, { headers });
  if (response.status === 400 || response.status === 404) {
    runs.push({ id, status: "NOT_FOUND" });
    continue;
  }
  if (!response.ok) throw new Error(`Trigger run ${id}: HTTP ${response.status}`);
  const run = await response.json();
  runs.push({
    id: run.id,
    status: run.status,
    taskIdentifier: run.taskIdentifier,
    createdAt: run.createdAt,
    payload: { route: run.payload?.route },
    output: { route: run.output?.route, confirmed: run.output?.confirmed },
    rootRunId: run.relatedRuns?.root?.id ?? run.relatedRuns?.parent?.id ?? null,
    rootTaskIdentifier: run.relatedRuns?.root?.taskIdentifier ?? run.relatedRuns?.parent?.taskIdentifier ?? null,
  });
}

const roots = new Set(runs.map((run) => run.rootRunId).filter(Boolean));
const ok = ids.length === tickets.length &&
  runs.length === tickets.length &&
  roots.size === 1 &&
  runs.every((run) => run.rootTaskIdentifier === "fa-fanout-audit");
writeFileSync(outputPath, JSON.stringify({ ok, rootRunId: [...roots][0] ?? null, runs }, null, 2) + "\n");
