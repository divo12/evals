#!/usr/bin/env node
/**
 * Harness self-test, NOT a durable solution. A straight-line in-memory orchestrator that
 * migrates the services, polls the world, and passes under PROFILE=smoke with no faults.
 * Kill it mid-run and it loses everything — which is exactly the failure mode the task grades.
 *
 *   PROFILE=smoke node environment/world.mjs &
 *   node solution/reference-naive.mjs
 *   bash tests/test.sh
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workspace = process.env.WORKSPACE ?? (existsSync("/app/RELEASE.md") ? "/app" : join(here, "../workspace"));
const WORLD = process.env.WORLD_URL ?? "http://world:4747";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (method, path, body) => {
  const res = await fetch(WORLD + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${json.error}`);
  return json;
};

// 1. code migration (deterministic rewrite of the generated call sites)
function migrate(service) {
  const dir = join(workspace, "services", service);
  let src = readFileSync(join(dir, "index.js"), "utf8");
  src = src
    .replace("acme-utils-1.4.2", "acme-utils-2.0.0")
    .replace("u.formatMoney(cents, currency)", "u.formatMoney({ amount: cents, currency })")
    .replace("u.retry((i) => fetcher(i), 3)", "u.retry((i) => fetcher(i), { attempts: 3 })")
    .replace("u.parseDuration(spec)", "u.durationMs(spec)");
  writeFileSync(join(dir, "index.js"), src);
  writeFileSync(join(dir, "deps.json"), JSON.stringify({ "acme-utils": "2.0.0" }, null, 2) + "\n");
}

const windows = await api("GET", "/windows");
await api("POST", "/run/start", { arm: "reference-naive", note: "in-memory polling script" });

const all = windows.batches.flatMap((b) => b.services);
for (const s of all) migrate(s);

// 2. CI until green (handles the one-off flake)
async function ciGreen(service) {
  for (;;) {
    const { runId } = await api("POST", "/ci/run", { service });
    let run;
    do { await sleep(2000); run = await api("GET", `/ci/run/${runId}`); } while (run.status === "running");
    if (run.status === "green") return;
    console.log(`ci ${service} failed: ${run.detail.split("\n")[0]}`);
    if (!/infra:/.test(run.detail)) throw new Error(`real CI failure for ${service}`);
  }
}
await Promise.all(all.map(ciGreen));
console.log("all CI green");

// 3. per batch: approval -> canary -> observe -> promote/rollback
const patched = [], rolledBack = [];
let lastPromoteAt = 0;
for (const b of windows.batches) {
  const { approvalId } = await api("POST", "/approvals/request", { batch: b.name, services: b.services });
  let a;
  do { await sleep(3000); a = await api("GET", `/approvals/${approvalId}`); } while (a.status !== "approved");
  console.log(`${b.name} approved`);

  for (const s of b.services) await api("POST", "/deploy", { service: s, stage: "canary", version: "2.0.0", approvalToken: a.token, idempotencyKey: `canary:${s}` });

  const pending = new Set(b.services);
  const deadline = Date.now() + windows.seconds.canary * 1000 + 1500;
  while (Date.now() < deadline && pending.size) {
    await sleep(3000);
    for (const s of [...pending]) {
      const m = await api("GET", `/metrics/${s}`);
      if (m.errorRate > 0.05) {
        await api("POST", "/deploy", { service: s, stage: "rollback", idempotencyKey: `rollback:${s}` });
        rolledBack.push(s); pending.delete(s);
        console.log(`rolled back ${s} (${m.errorRate})`);
      }
    }
  }
  for (const s of pending) {
    await api("POST", "/deploy", { service: s, stage: "promote", idempotencyKey: `promote:${s}` });
    patched.push(s); lastPromoteAt = Date.now();
  }
  console.log(`${b.name} done`);
}

// 4. follow-up
await sleep(Math.max(0, lastPromoteAt + windows.seconds.followUp * 1000 - Date.now()));
for (const s of all) await api("GET", `/services/${s}`);
await api("POST", "/notify", { channel: "releases", text: `release train done: ${patched.length} patched, ${rolledBack.length} rolled back`, data: { patched, rolledBack } });
await api("POST", "/run/finish", { arm: "reference-naive", summary: { patched, rolledBack } });
console.log("finished");
