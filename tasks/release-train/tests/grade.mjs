#!/usr/bin/env node
/**
 * Grades a release-train run from the world ledger only.
 *
 *   node tests/grade.mjs                 # writes tests/results.json and tests/reward.txt
 *   node tests/grade.mjs --ledger path   # grade a saved ledger
 *
 * reward = 1 only if every invariant holds AND no human relaunch happened.
 * assistedReward = same invariants, relaunches ignored (useful to see how far an arm got).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));
const taskDir = join(testsDir, "..");
const argIdx = process.argv.indexOf("--ledger");
const ledgerPath = argIdx > -1 ? process.argv[argIdx + 1] : join(taskDir, "environment/ledger.jsonl");
const oracle = JSON.parse(readFileSync(join(taskDir, "environment/oracle.json"), "utf8"));

if (!existsSync(ledgerPath)) { console.error(`no ledger at ${ledgerPath}`); process.exit(2); }
const ledger = readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const of = (kind) => ledger.filter((r) => r.kind === kind);

const worldStart = of("world.start")[0];
if (!worldStart) { console.error("ledger has no world.start"); process.exit(2); }
const W = worldStart.windows; // seconds
const good = oracle.services.filter((s) => !oracle.degrade.includes(s));
const bad = oracle.degrade;

const checks = [];
const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); return !!pass; };

// ---------------------------------------------------------------------------
// side effects: exactly once
// ---------------------------------------------------------------------------
const effects = of("deploy").filter((r) => r.effect);
const count = (service, stage) => effects.filter((r) => r.service === service && r.stage === stage).length;

check("every service canaried exactly once", oracle.services.every((s) => count(s, "canary") === 1),
  oracle.services.filter((s) => count(s, "canary") !== 1).map((s) => `${s}:${count(s, "canary")}`));
check("healthy services promoted exactly once", good.every((s) => count(s, "promote") === 1),
  good.filter((s) => count(s, "promote") !== 1).map((s) => `${s}:${count(s, "promote")}`));
check("degraded services rolled back exactly once", bad.every((s) => count(s, "rollback") === 1),
  bad.filter((s) => count(s, "rollback") !== 1).map((s) => `${s}:${count(s, "rollback")}`));
check("degraded services never promoted", bad.every((s) => count(s, "promote") === 0),
  bad.filter((s) => count(s, "promote") > 0));
check("healthy services never rolled back", good.every((s) => count(s, "rollback") === 0),
  good.filter((s) => count(s, "rollback") > 0));
check("all deploy effects carried an idempotencyKey", effects.every((r) => r.idempotencyKey),
  effects.filter((r) => !r.idempotencyKey).map((r) => `${r.service}/${r.stage}`));

// ---------------------------------------------------------------------------
// gates: CI green + approval before canary (world enforces; verify from ledger order)
// ---------------------------------------------------------------------------
const approvalRequests = of("approval.request");
const approvalDecisions = of("approval.decision");
check("each batch approved exactly once", oracle.batches.every((_, i) => approvalRequests.filter((r) => r.batch === `batch-${i + 1}`).length === 1),
  approvalRequests.map((r) => r.batch));

const canaryAt = (s) => effects.find((r) => r.service === s && r.stage === "canary")?.t;
const approvedAt = (batch) => approvalDecisions.find((r) => r.batch === batch)?.t;
const batchOf = (s) => `batch-${oracle.batches.findIndex((b) => b.includes(s)) + 1}`;
check("canary only after batch approval", oracle.services.every((s) => canaryAt(s) && approvedAt(batchOf(s)) && canaryAt(s) >= approvedAt(batchOf(s))),
  oracle.services.filter((s) => !(canaryAt(s) && approvedAt(batchOf(s)) && canaryAt(s) >= approvedAt(batchOf(s)))));

// ---------------------------------------------------------------------------
// canary discipline and rollback latency
// ---------------------------------------------------------------------------
const rollbackLatency = {};
for (const s of bad) {
  const c = canaryAt(s);
  const rb = effects.find((r) => r.service === s && r.stage === "rollback")?.t;
  if (c && rb) rollbackLatency[s] = Math.round((rb - (c + W.degradeAfter * 1000)) / 1000);
}
const rbTolerance = Math.max(30, Math.round((W.canary - W.degradeAfter) * 0.5));
check(`rollback within ${rbTolerance}s of degradation`, bad.every((s) => rollbackLatency[s] !== undefined && rollbackLatency[s] >= -5 && rollbackLatency[s] <= rbTolerance),
  rollbackLatency);

// ---------------------------------------------------------------------------
// follow-up: exactly one summary, on time, with the right content
// ---------------------------------------------------------------------------
const promotes = effects.filter((r) => r.stage === "promote");
const lastPromote = promotes.length ? Math.max(...promotes.map((r) => r.t)) : null;
const releaseNotes = of("notify").filter((r) => r.channel === "releases");
const note = releaseNotes[0];
const followTolerance = Math.max(60, Math.round(W.followUp * 0.1));
let followUpDelta = null;
if (note && lastPromote) followUpDelta = Math.round((note.t - lastPromote) / 1000 - W.followUp);

check("exactly one follow-up posted to #releases", releaseNotes.length === 1, releaseNotes.length);
check(`follow-up posted ${W.followUp}s ±${followTolerance}s after last promotion`, followUpDelta !== null && followUpDelta >= -5 && followUpDelta <= followTolerance, followUpDelta);

const sortEq = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());
const data = note?.data ?? tryParse(note?.text);
check("follow-up lists patched services correctly", sortEq(data?.patched, good), data?.patched);
check("follow-up lists rolled-back services correctly", sortEq(data?.rolledBack, bad), data?.rolledBack);

function tryParse(t) { try { return JSON.parse(t); } catch { return null; } }

// ---------------------------------------------------------------------------
// autonomy + cost
// ---------------------------------------------------------------------------
const starts = of("run.start");
const relaunches = Math.max(0, starts.length - 1);
const faults = of("fault");
check("run announced itself (POST /run/start)", starts.length >= 1, starts.length);

const polls = { ci: of("ci.poll").length, approvals: of("approval.poll").length, metrics: of("metrics.read").length, services: of("service.read").length };
const callbacksUsed = of("callback").length;
const firstT = starts[0]?.t ?? worldStart.t;
const lastT = Math.max(...ledger.map((r) => r.t));

const invariantsHold = checks.every((c) => c.pass);
const results = {
  ledger: ledgerPath,
  profile: worldStart.profile,
  arm: starts[0]?.arm ?? null,
  reward: invariantsHold && relaunches === 0 ? 1 : 0,
  assistedReward: invariantsHold ? 1 : 0,
  relaunches,
  faultsInjected: faults.map((f) => f.type),
  wallClockSeconds: Math.round((lastT - firstT) / 1000),
  rollbackLatencySeconds: rollbackLatency,
  followUpDeltaSeconds: followUpDelta,
  deployEffects: effects.length,
  deployRejected: of("deploy.rejected").length,
  deployDeduplicated: of("deploy").filter((r) => r.deduplicated).length,
  ciAttempts: of("ci.request").length,
  polls,
  callbacksUsed,
  checks,
};

writeFileSync(join(testsDir, "results.json"), JSON.stringify(results, null, 2) + "\n");
writeFileSync(join(testsDir, "reward.txt"), String(results.reward) + "\n");

for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.pass ? "" : "  -> " + JSON.stringify(c.detail)}`);
console.log(`\nreward=${results.reward} assistedReward=${results.assistedReward} relaunches=${relaunches} wallClock=${results.wallClockSeconds}s polls=${JSON.stringify(polls)} callbacks=${callbacksUsed}`);
process.exit(results.reward ? 0 : 1);
