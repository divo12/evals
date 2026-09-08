#!/usr/bin/env node
/**
 * Grades a release-train run from the world ledger only.
 * Harbor writes /logs/verifier/reward.txt (and reward.json). Local fallback: tests/.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));
const arg = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const requireTrigger = process.argv.includes("--require-trigger");

function isTriggerWaitUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host === "trigger.dev" || host.endsWith(".trigger.dev");
  } catch {
    return false;
  }
}

const logsDir = process.env.VERIFIER_LOGS ?? (existsSync("/logs/verifier") ? "/logs/verifier" : testsDir);
const ledgerPath = arg("--ledger", process.env.LEDGER_PATH ?? join(testsDir, "../environment/ledger.jsonl"));
const oraclePath = arg("--oracle", process.env.ORACLE_PATH ?? join(testsDir, "fixtures/oracle.json"));

mkdirSync(logsDir, { recursive: true });

function failInfra(msg) {
  writeFileSync(join(logsDir, "error.txt"), msg + "\n");
  console.error(msg);
  process.exit(2);
}

if (!existsSync(oraclePath)) failInfra(`oracle missing at ${oraclePath}`);
if (!existsSync(ledgerPath)) failInfra(`ledger missing at ${ledgerPath}`);

const oracle = JSON.parse(readFileSync(oraclePath, "utf8"));
const ledger = readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const of = (kind) => ledger.filter((r) => r.kind === kind);

const worldStart = of("world.start")[0];
if (!worldStart) failInfra("ledger has no world.start");
const W = worldStart.windows;
const good = oracle.services.filter((s) => !oracle.degrade.includes(s));
const bad = oracle.degrade;

const checks = [];
const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); return !!pass; };

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

const approvalRequests = of("approval.request");
const approvalDecisions = of("approval.decision");
check("each batch approved exactly once", oracle.batches.every((_, i) => approvalRequests.filter((r) => r.batch === `batch-${i + 1}`).length === 1),
  approvalRequests.map((r) => r.batch));
check("batches requested in release order", approvalRequests.every((r, i) => r.batch === `batch-${i + 1}`),
  approvalRequests.map((r) => r.batch));

const greenCi = of("ci.result").filter((r) => r.status === "green" && r.version === "2.0.0");
check("every service reached CI green at 2.0.0", oracle.services.every((s) => greenCi.some((r) => r.service === s)),
  oracle.services.filter((s) => !greenCi.some((r) => r.service === s)));

const canaryAt = (s) => effects.find((r) => r.service === s && r.stage === "canary")?.t;
const approvedAt = (batch) => approvalDecisions.find((r) => r.batch === batch)?.t;
const batchOf = (s) => `batch-${oracle.batches.findIndex((b) => b.includes(s)) + 1}`;
check("canary only after batch approval", oracle.services.every((s) => canaryAt(s) && approvedAt(batchOf(s)) && canaryAt(s) >= approvedAt(batchOf(s))),
  oracle.services.filter((s) => !(canaryAt(s) && approvedAt(batchOf(s)) && canaryAt(s) >= approvedAt(batchOf(s)))));

const rollbackLatency = {};
for (const s of bad) {
  const c = canaryAt(s);
  const rb = effects.find((r) => r.service === s && r.stage === "rollback")?.t;
  if (c && rb) rollbackLatency[s] = Math.round((rb - (c + W.degradeAfter * 1000)) / 1000);
}
const rbTolerance = Math.max(30, Math.round((W.canary - W.degradeAfter) * 0.5));
check(`rollback within ${rbTolerance}s of degradation`, bad.every((s) => rollbackLatency[s] !== undefined && rollbackLatency[s] >= -5 && rollbackLatency[s] <= rbTolerance),
  rollbackLatency);

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

const readsBeforeNote = of("service.read").filter((r) => note && lastPromote && r.t >= lastPromote && r.t <= note.t);
check("every service re-read after the last promotion", oracle.services.every((s) => readsBeforeNote.some((r) => r.service === s)),
  oracle.services.filter((s) => !readsBeforeNote.some((r) => r.service === s)));

function tryParse(t) { try { return JSON.parse(t); } catch { return null; } }

const starts = of("run.start");
const relaunches = Math.max(0, starts.length - 1);
const faults = of("fault");
check("run announced itself (POST /run/start)", starts.length >= 1, starts.length);
const finishes = of("run.finish");
check("run finished exactly once after the follow-up", finishes.length === 1 && note && finishes[0].t >= note.t, finishes.length);

if (requireTrigger) {
  const callbacks = of("callback").filter((r) => r.httpStatus >= 200 && r.httpStatus < 300 && isTriggerWaitUrl(r.url));
  const ciCallbacks = callbacks.filter((r) => r.event === "ci.finished");
  const approvalCallbacks = callbacks.filter((r) => r.event === "approval.decided");
  check("every CI request used a Trigger wait token", of("ci.request").every((r) => r.callback) &&
    of("ci.result").every((r) => ciCallbacks.some((c) => c.runId === r.runId)), ciCallbacks.length);
  check("every approval used a Trigger wait token", approvalRequests.every((r) => r.callback) &&
    approvalDecisions.every((r) => approvalCallbacks.some((c) => c.approvalId === r.approvalId)), approvalCallbacks.length);
  check("Trigger workflow did not poll CI or approvals", of("ci.poll").length === 0 && of("approval.poll").length === 0,
    { ci: of("ci.poll").length, approvals: of("approval.poll").length });
}

const polls = { ci: of("ci.poll").length, approvals: of("approval.poll").length, metrics: of("metrics.read").length, services: of("service.read").length };
const callbacksUsed = of("callback").length;
const firstT = starts[0]?.t ?? worldStart.t;
const lastT = Math.max(...ledger.map((r) => r.t));

const invariantsHold = checks.every((c) => c.pass);
const reward = invariantsHold && relaunches === 0 ? 1 : 0;
const results = {
  ledger: ledgerPath,
  profile: worldStart.profile,
  arm: starts[0]?.arm ?? null,
  reward,
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

writeFileSync(join(logsDir, "results.json"), JSON.stringify(results, null, 2) + "\n");
writeFileSync(join(logsDir, "reward.txt"), String(reward) + "\n");

for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.pass ? "" : "  -> " + JSON.stringify(c.detail)}`);
console.log(`\nreward=${reward} assistedReward=${results.assistedReward} relaunches=${relaunches} wallClock=${results.wallClockSeconds}s`);
process.exit(0);
