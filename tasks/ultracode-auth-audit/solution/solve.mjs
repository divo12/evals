#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.env.WORKDIR ?? "/app";
const tracker = process.env.TRACKER_URL ?? "http://tracker:9410";
const publicRoutes = new Set(["health", "status", "openapi", "login", "signup", "stripe-webhook"]);
const dir = join(root, "src/routes");

const confirmed = [];
const rejected = [];
for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
  const name = file.replace(/\.ts$/, "");
  const src = readFileSync(join(dir, file), "utf8");
  const missing = !src.includes("requireAuth");
  if (publicRoutes.has(name)) {
    if (missing) rejected.push(name);
    continue;
  }
  if (missing) confirmed.push(name);
  else rejected.push(name);
}

const tickets = [];
for (const route of confirmed) {
  const res = await fetch(`${tracker}/tickets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ route, issue: "missing requireAuth", idempotencyKey: route }),
  });
  if (!res.ok) throw new Error(`ticket ${route} ${res.status}`);
  const body = await res.json();
  tickets.push(body.id);
}

writeFileSync(join(root, "report.json"), JSON.stringify({ confirmed, rejected, tickets }, null, 2) + "\n");

function ci() {
  return spawnSync("bash", [join(root, "scripts/ci.sh")], { stdio: "inherit", env: process.env });
}

let run = ci();
if (run.status !== 0) run = ci();
if (run.status !== 0) process.exit(run.status ?? 1);
console.log(`filed ${tickets.length} tickets, ci ok`);
