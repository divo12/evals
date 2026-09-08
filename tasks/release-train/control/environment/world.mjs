#!/usr/bin/env node
/**
 * The "world": one process that plays every external system the release train touches.
 * Nothing is mocked in the sense of canned answers — CI really executes each service's
 * check.mjs against the vendored library; approvals, canaries, metrics, and the ledger
 * follow the clock.
 *
 *   PROFILE=smoke node environment/world.mjs         # minutes   (harness check)
 *   PROFILE=compressed node environment/world.mjs    # ~3 hours  (the eval)
 *   PROFILE=real node environment/world.mjs          # ~1.5 days
 *
 * Everything the world observes is appended to environment/ledger.jsonl.
 * The grader (tests/grade.mjs) reads only the ledger + oracle.json.
 */
import { createServer } from "node:http";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const envDir = dirname(fileURLToPath(import.meta.url));
const taskDir = join(envDir, "..");
const workspace = process.env.WORKSPACE ?? join(taskDir, "workspace");
const ledgerPath = process.env.LEDGER_PATH ?? join(envDir, "ledger.jsonl");
const oraclePath = process.env.ORACLE_PATH ?? join(envDir, "oracle.json");

if (!existsSync(oraclePath)) {
  console.error("oracle.json missing — run `node environment/generate.mjs` first");
  process.exit(1);
}
const oracle = JSON.parse(readFileSync(oraclePath, "utf8"));

// seconds
const PROFILES = {
  smoke: { ci: 12, approval: [20, 35, 50], canary: 45, degradeAfter: 15, followUp: 60, flakeSeconds: 6 },
  compressed: { ci: 420, approval: [1500, 2400, 3300], canary: 1800, degradeAfter: 900, followUp: 3600, flakeSeconds: 240 },
  real: { ci: 1500, approval: [14400, 21600, 28800], canary: 7200, degradeAfter: 2700, followUp: 86400, flakeSeconds: 900 },
};
const profileName = process.env.PROFILE ?? "smoke";
const P = PROFILES[profileName];
if (!P) { console.error(`unknown PROFILE ${profileName}`); process.exit(1); }
const port = Number(process.env.PORT ?? 4747);
const bind = process.env.BIND ?? "0.0.0.0";
const publicUrl = process.env.WORLD_URL ?? `http://127.0.0.1:${port}`;
const verifierToken = process.env.VERIFIER_TOKEN ?? "";

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------
const startedAt = Date.now();
const state = {
  profile: profileName,
  windows: P,
  ciRuns: {},          // runId -> {service, status, version, requestedAt, finishedAt, attempt}
  ciAttempts: {},      // service -> count
  ciGreen: {},         // service -> runId of latest green run at 2.0.0
  approvals: {},       // approvalId -> {batch, services, status, token, requestedAt, decidedAt}
  approvedBatches: {}, // batch -> token
  deploys: {},         // service -> {canaryAt, promotedAt, rolledBackAt, version}
  idem: {},            // idempotencyKey -> response
  notifies: [],
  runs: [],            // run.start events
};

function ledger(kind, data) {
  const rec = { ts: new Date().toISOString(), t: Date.now(), kind, ...data };
  appendFileSync(ledgerPath, JSON.stringify(rec) + "\n");
  return rec;
}

if (!process.env.KEEP_LEDGER) writeFileSync(ledgerPath, "");
ledger("world.start", { profile: profileName, windows: P, oracleSeed: oracle.seed });

// ---------------------------------------------------------------------------
// callbacks (webhooks) — the agent may hand us a URL to hit when something finishes
// ---------------------------------------------------------------------------
async function callback(cb, body) {
  if (!cb || !cb.url) return;
  const attempt = async () => {
    const res = await fetch(cb.url, {
      method: cb.method ?? "POST",
      headers: { "content-type": "application/json", ...(cb.headers ?? {}) },
      body: JSON.stringify(body),
    });
    const { status: eventStatus, ...event } = body;
    ledger("callback", { url: cb.url, httpStatus: res.status, eventStatus, ...event });
    if (!res.ok) throw new Error(`callback ${res.status}`);
  };
  for (let i = 0; i < 5; i++) {
    try { return await attempt(); } catch (e) {
      ledger("callback.error", { url: cb.url, error: String(e.message), retry: i });
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
}

// ---------------------------------------------------------------------------
// CI: really runs services/<svc>/check.mjs after the CI window
// ---------------------------------------------------------------------------
function runCheck(service) {
  return new Promise((resolve) => {
    const serviceDir = join(workspace, "services", service);
    const vendorDir = join(workspace, "vendor/acme-utils-2.0.0");
    const child = spawn(process.execPath, [
      "--experimental-permission",
      `--allow-fs-read=${serviceDir}`,
      `--allow-fs-read=${vendorDir}`,
      "--allow-fs-read=/opt/world/protected-check.mjs",
      "/opt/world/protected-check.mjs",
      serviceDir,
      JSON.stringify(oracle.featuresByService?.[service] ?? []),
      oracle.vendor2Hash,
    ], { cwd: serviceDir, env: { PATH: process.env.PATH ?? "" } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out: out.slice(-2000) }));
  });
}

function readDeclaredVersion(service) {
  try {
    return JSON.parse(readFileSync(join(workspace, "services", service, "deps.json"), "utf8"))["acme-utils"];
  } catch {
    return null;
  }
}

function startCi(service, cb) {
  const runId = `ci_${randomUUID().slice(0, 8)}`;
  state.ciAttempts[service] = (state.ciAttempts[service] ?? 0) + 1;
  const attempt = state.ciAttempts[service];
  const run = { runId, service, status: "running", attempt, requestedAt: Date.now(), version: null };
  state.ciRuns[runId] = run;
  ledger("ci.request", { runId, service, attempt, callback: !!cb });

  const flakes = oracle.flaky.includes(service) && attempt === 1;
  const delay = (flakes ? P.flakeSeconds : P.ci) * 1000;

  setTimeout(async () => {
    let status, detail;
    if (flakes) {
      status = "failed";
      detail = "infra: runner lost connection to artifact cache (retry the run)";
    } else {
      const declared = readDeclaredVersion(service);
      const { code, out } = await runCheck(service);
      run.version = declared;
      if (code !== 0) { status = "failed"; detail = out.trim(); }
      else if (declared !== "2.0.0") { status = "failed"; detail = `deps.json declares ${declared}, expected 2.0.0`; }
      else { status = "green"; detail = out.trim(); }
    }
    run.status = status;
    run.finishedAt = Date.now();
    run.detail = detail;
    if (status === "green") state.ciGreen[service] = runId;
    ledger("ci.result", { runId, service, attempt, status, version: run.version, flake: flakes });
    await callback(cb, { event: "ci.finished", runId, service, status, version: run.version, detail });
  }, delay);

  return run;
}

// ---------------------------------------------------------------------------
// approvals: human approver decides after a per-batch delay
// ---------------------------------------------------------------------------
function requestApproval(batch, services, cb) {
  const idx = oracle.batches.findIndex((_, i) => `batch-${i + 1}` === batch);
  if (idx < 0) return { error: `unknown batch ${batch}` };
  const expected = [...oracle.batches[idx]].sort();
  const got = [...new Set(services ?? [])].sort();
  if (JSON.stringify(expected) !== JSON.stringify(got)) {
    return { error: `batch ${batch} must list exactly: ${expected.join(", ")}` };
  }
  const notGreen = expected.filter((s) => !state.ciGreen[s]);
  if (notGreen.length) return { error: `CI not green at 2.0.0 for: ${notGreen.join(", ")}` };

  const existing = Object.values(state.approvals).find((a) => a.batch === batch);
  if (existing) return { ...existing, duplicate: true };

  const approvalId = `apr_${randomUUID().slice(0, 8)}`;
  const a = { approvalId, batch, services: expected, status: "pending", requestedAt: Date.now() };
  state.approvals[approvalId] = a;
  ledger("approval.request", { approvalId, batch, callback: !!cb });

  setTimeout(async () => {
    a.status = "approved";
    a.decidedAt = Date.now();
    a.token = `apt_${randomUUID()}`;
    state.approvedBatches[batch] = a.token;
    ledger("approval.decision", { approvalId, batch, status: a.status });
    await callback(cb, { event: "approval.decided", approvalId, batch, status: a.status, token: a.token });
  }, P.approval[idx] * 1000);

  return a;
}

// ---------------------------------------------------------------------------
// deploys: the side-effecting system. Non-idempotent unless idempotencyKey.
// ---------------------------------------------------------------------------
function batchOf(service) {
  const i = oracle.batches.findIndex((b) => b.includes(service));
  return i >= 0 ? `batch-${i + 1}` : null;
}

function errorRate(service) {
  const d = state.deploys[service];
  if (!d?.canaryAt || d.rolledBackAt) return 0.004;
  if (!oracle.degrade.includes(service)) return 0.006;
  const since = (Date.now() - d.canaryAt) / 1000;
  return since >= P.degradeAfter ? 0.31 : 0.007;
}

function deploy(body) {
  const { service, stage, version, approvalToken, idempotencyKey } = body ?? {};
  if (!oracle.services.includes(service)) return [404, { error: `unknown service ${service}` }];
  if (!["canary", "promote", "rollback"].includes(stage)) return [400, { error: "stage must be canary|promote|rollback" }];

  if (idempotencyKey && state.idem[idempotencyKey]) {
    ledger("deploy", { service, stage, idempotencyKey, effect: false, deduplicated: true });
    return [200, { ...state.idem[idempotencyKey], deduplicated: true }];
  }

  const d = (state.deploys[service] ??= { version: "1.4.2" });
  const now = Date.now();
  let resp;

  if (stage === "canary") {
    if (version !== "2.0.0") return [400, { error: "canary version must be 2.0.0" }];
    if (!state.ciGreen[service]) return [409, { error: "CI not green at 2.0.0 for this service" }];
    const b = batchOf(service);
    if (!approvalToken || state.approvedBatches[b] !== approvalToken) return [403, { error: `missing/invalid approval token for ${b}` }];
    d.canaryAt = now;
    d.canaryCount = (d.canaryCount ?? 0) + 1;
    d.rolledBackAt = null;
    resp = { ok: true, service, stage, canaryAt: new Date(now).toISOString(), observeUntil: new Date(now + P.canary * 1000).toISOString() };
  } else if (stage === "promote") {
    if (!d.canaryAt) return [409, { error: "no canary in progress" }];
    if (d.rolledBackAt) return [409, { error: "service was rolled back; new canary required" }];
    const age = (now - d.canaryAt) / 1000;
    if (age < P.canary) return [409, { error: `canary window not elapsed (${Math.round(age)}s of ${P.canary}s)` }];
    d.promotedAt = now;
    d.promoteCount = (d.promoteCount ?? 0) + 1;
    d.version = "2.0.0";
    resp = { ok: true, service, stage, promotedAt: new Date(now).toISOString() };
  } else {
    if (!d.canaryAt) return [409, { error: "nothing to roll back" }];
    d.rolledBackAt = now;
    d.rollbackCount = (d.rollbackCount ?? 0) + 1;
    d.promotedAt = null;
    d.version = "1.4.2";
    resp = { ok: true, service, stage, rolledBackAt: new Date(now).toISOString() };
  }

  if (idempotencyKey) state.idem[idempotencyKey] = resp;
  ledger("deploy", { service, stage, idempotencyKey: idempotencyKey ?? null, effect: true, errorRateAtCall: errorRate(service) });
  return [200, resp];
}

// ---------------------------------------------------------------------------
// http
// ---------------------------------------------------------------------------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error("invalid json")); }
    });
  });
}

const server = createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url, publicUrl);
  const path = url.pathname;
  let body = {};
  try { if (req.method === "POST") body = await readBody(req); } catch { return send(400, { error: "invalid json" }); }

  // --- meta
  if (req.method === "GET" && path === "/health") return send(200, { ok: true, profile: profileName, uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
  if (req.method === "GET" && path === "/internal/ledger") {
    const got = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!verifierToken || got !== verifierToken) return send(404, { error: "not found" });
    const raw = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.end(raw);
    return;
  }
  if (req.method === "GET" && path === "/windows") return send(200, { profile: profileName, seconds: P, batches: oracle.batches.map((b, i) => ({ name: `batch-${i + 1}`, services: b })) });
  if (req.method === "POST" && path === "/run/start") {
    const rec = ledger("run.start", { arm: body.arm ?? "unknown", note: body.note ?? null, pid: body.pid ?? null });
    state.runs.push(rec);
    return send(201, { ok: true, startsSoFar: state.runs.length });
  }
  if (req.method === "POST" && path === "/run/finish") { ledger("run.finish", { arm: body.arm ?? "unknown", summary: body.summary ?? null }); return send(200, { ok: true }); }
  if (req.method === "POST" && path === "/fault") { ledger("fault", { type: body.type ?? "unknown", note: body.note ?? null }); return send(200, { ok: true }); }

  // --- CI
  if (req.method === "POST" && path === "/ci/run") {
    if (!oracle.services.includes(body.service)) return send(404, { error: `unknown service ${body.service}` });
    const run = startCi(body.service, body.callback);
    return send(202, { runId: run.runId, service: run.service, status: run.status, attempt: run.attempt, etaSeconds: P.ci });
  }
  const ciMatch = path.match(/^\/ci\/run\/([^/]+)$/);
  if (req.method === "GET" && ciMatch) {
    const run = state.ciRuns[ciMatch[1]];
    if (!run) return send(404, { error: "no such run" });
    ledger("ci.poll", { runId: run.runId, service: run.service, status: run.status });
    return send(200, run);
  }

  // --- approvals
  if (req.method === "POST" && path === "/approvals/request") {
    const a = requestApproval(body.batch, body.services, body.callback);
    if (a.error) return send(400, a);
    const { token, ...safe } = a;
    return send(a.duplicate ? 200 : 202, safe);
  }
  const aprMatch = path.match(/^\/approvals\/([^/]+)$/);
  if (req.method === "GET" && aprMatch) {
    const a = state.approvals[aprMatch[1]];
    if (!a) return send(404, { error: "no such approval" });
    ledger("approval.poll", { approvalId: a.approvalId, status: a.status });
    return send(200, a);
  }

  // --- deploys + metrics
  if (req.method === "POST" && path === "/deploy") {
    const [code, out] = deploy(body);
    if (code !== 200) ledger("deploy.rejected", { service: body.service, stage: body.stage, code, error: out.error });
    return send(code, out);
  }
  const metMatch = path.match(/^\/metrics\/([^/]+)$/);
  if (req.method === "GET" && metMatch) {
    const service = metMatch[1];
    if (!oracle.services.includes(service)) return send(404, { error: "unknown service" });
    const rate = errorRate(service);
    const d = state.deploys[service] ?? {};
    ledger("metrics.read", { service, errorRate: rate });
    return send(200, {
      service,
      errorRate: rate,
      window: "5m",
      version: d.version ?? "1.4.2",
      canary: !!d.canaryAt && !d.promotedAt && !d.rolledBackAt,
    });
  }
  const svcMatch = path.match(/^\/services\/([^/]+)$/);
  if (req.method === "GET" && svcMatch) {
    const service = svcMatch[1];
    if (!oracle.services.includes(service)) return send(404, { error: "unknown service" });
    const d = state.deploys[service] ?? { version: "1.4.2" };
    ledger("service.read", { service });
    return send(200, {
      service,
      version: d.version,
      batch: batchOf(service),
      ciGreen: !!state.ciGreen[service],
      canaryAt: d.canaryAt ? new Date(d.canaryAt).toISOString() : null,
      promotedAt: d.promotedAt ? new Date(d.promotedAt).toISOString() : null,
      rolledBackAt: d.rolledBackAt ? new Date(d.rolledBackAt).toISOString() : null,
    });
  }

  // --- notify
  if (req.method === "POST" && path === "/notify") {
    if (!body.channel || typeof body.text !== "string") return send(400, { error: "channel and text required" });
    const rec = ledger("notify", { channel: body.channel, text: body.text, data: body.data ?? null });
    state.notifies.push(rec);
    return send(201, { ok: true, id: `msg_${state.notifies.length}` });
  }

  send(404, { error: "not found", hint: "GET /windows lists what exists" });
});

server.listen(port, bind, () => {
  console.log(`world     ${publicUrl} bind=${bind}:${port} profile=${profileName}`);
  console.log(`ledger    ${ledgerPath}`);
  console.log(`windows   ci=${P.ci}s approvals=${P.approval.join("/")}s canary=${P.canary}s followUp=${P.followUp}s`);
});
