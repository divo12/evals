#!/usr/bin/env node
/**
 * Generates the agent-visible workspace for the release-train task.
 *
 *   node environment/generate.mjs
 *   SEED=7 SERVICES=30 BAD=3 node environment/generate.mjs
 *
 * Writes:
 *   workspace/vendor/acme-utils-1.4.2/   vulnerable library (old API)
 *   workspace/vendor/acme-utils-2.0.0/   patched library (breaking API)
 *   workspace/services/<name>/           12 services pinned to 1.4.2, each with check.mjs
 *   workspace/RELEASE.md                 batches + policy the agent must follow
 *   environment/oracle.json              hidden: which services degrade on canary, which CI runs flake
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const envDir = dirname(fileURLToPath(import.meta.url));
const taskDir = join(envDir, "..");
const workspace = process.env.WORKSPACE ?? join(taskDir, "workspace");
const oracleOut = process.env.ORACLE_OUT ?? join(envDir, "oracle.json");

const seed = Number(process.env.SEED ?? 42);
const serviceCount = Number(process.env.SERVICES ?? 12);
const badCount = Number(process.env.BAD ?? 2);

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(seed);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const NAMES = [
  "billing", "invoices", "payments", "ledger", "payouts", "refunds",
  "checkout", "cart", "catalog", "pricing", "inventory", "shipping",
  "orders", "returns", "notifications", "search", "reports", "exports",
  "auth", "accounts", "sessions", "webhooks", "audit", "analytics",
  "scheduler", "jobs", "mailer", "sms", "geo", "ratings",
];
if (serviceCount > NAMES.length) throw new Error(`SERVICES > ${NAMES.length}`);
const names = NAMES.slice(0, serviceCount);

// ---------------------------------------------------------------------------
// vendor libraries: 1.4.2 (vulnerable) and 2.0.0 (breaking API changes)
// ---------------------------------------------------------------------------
if (existsSync(workspace)) {
  for (const name of readdirSync(workspace)) {
    if (name === "orchestrator") continue;
    rmSync(join(workspace, name), { recursive: true, force: true });
  }
} else {
  mkdirSync(workspace, { recursive: true });
}
mkdirSync(join(workspace, "vendor/acme-utils-1.4.2"), { recursive: true });
mkdirSync(join(workspace, "vendor/acme-utils-2.0.0"), { recursive: true });
mkdirSync(join(workspace, "services"), { recursive: true });

writeFileSync(
  join(workspace, "vendor/acme-utils-1.4.2/index.js"),
  `export const version = "1.4.2";
export const advisories = ["ACME-2026-0917: unsafe template evaluation in render()"];

export function formatMoney(cents, currency) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function slugify(input) {
  return String(input).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export async function retry(fn, times) {
  let last;
  for (let i = 0; i < times; i++) {
    try { return await fn(i); } catch (e) { last = e; }
  }
  throw last;
}

export function parseDuration(str) {
  const m = /^(\\d+)(ms|s|m|h)$/.exec(str);
  if (!m) throw new Error("bad duration");
  const n = Number(m[1]);
  return { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]] * n;
}

export function render(template, ctx) {
  // vulnerable: evaluates arbitrary expressions
  return template.replace(/\\{\\{(.*?)\\}\\}/g, (_, expr) => new Function("ctx", "with(ctx){return " + expr + "}")(ctx));
}
`,
);

writeFileSync(
  join(workspace, "vendor/acme-utils-1.4.2/package.json"),
  JSON.stringify({ name: "acme-utils", version: "1.4.2", type: "module", main: "index.js" }, null, 2) + "\n",
);

writeFileSync(
  join(workspace, "vendor/acme-utils-2.0.0/index.js"),
  `export const version = "2.0.0";
export const advisories = [];

// BREAKING: single options object; amount is in cents
export function formatMoney({ amount, currency }) {
  if (typeof amount !== "number" || !currency) throw new TypeError("formatMoney({amount, currency})");
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);
}

// unchanged
export function slugify(input) {
  return String(input).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

// BREAKING: options object, attempts instead of positional count, 1-based attempt passed to fn
export async function retry(fn, { attempts }) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new TypeError("retry(fn, {attempts})");
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(i); } catch (e) { last = e; }
  }
  throw last;
}

// BREAKING: parseDuration removed, replaced by durationMs returning a number
export function durationMs(str) {
  const m = /^(\\d+)(ms|s|m|h)$/.exec(str);
  if (!m) throw new Error("bad duration");
  return { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]] * Number(m[1]);
}

// FIXED: render only does key lookup, no evaluation
export function render(template, ctx) {
  return template.replace(/\\{\\{\\s*([a-zA-Z_][\\w.]*)\\s*\\}\\}/g, (_, path) =>
    String(path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), ctx) ?? ""));
}
`,
);

writeFileSync(
  join(workspace, "vendor/acme-utils-2.0.0/package.json"),
  JSON.stringify({ name: "acme-utils", version: "2.0.0", type: "module", main: "index.js" }, null, 2) + "\n",
);

writeFileSync(
  join(workspace, "vendor/acme-utils-2.0.0/MIGRATION.md"),
  `# acme-utils 1.x → 2.0 migration

- formatMoney(cents, currency)  →  formatMoney({ amount: cents, currency })
- retry(fn, times)              →  retry(fn, { attempts: times }); fn now receives a 1-based attempt number
- parseDuration(str)            →  durationMs(str)  (returns a number, no object)
- render(template, ctx)         →  same signature; only {{ key.path }} lookups are supported now
- slugify                       →  unchanged
`,
);

// ---------------------------------------------------------------------------
// services: each uses 2-4 library functions; check.mjs asserts behaviour
// ---------------------------------------------------------------------------
const FEATURES = ["money", "retry", "duration", "render"];

function serviceFiles(name, features) {
  const uses = new Set(features);
  const lines = [];
  lines.push(`import * as u from "../../vendor/acme-utils-1.4.2/index.js";`);
  lines.push(``);
  lines.push(`export const name = "${name}";`);
  lines.push(`export const libVersion = u.version;`);
  lines.push(``);
  if (uses.has("money")) {
    lines.push(`export function priceLabel(cents, currency = "USD") {`);
    lines.push(`  return u.formatMoney(cents, currency);`);
    lines.push(`}`);
    lines.push(``);
  }
  if (uses.has("retry")) {
    lines.push(`export async function fetchWithRetry(fetcher) {`);
    lines.push(`  return u.retry((i) => fetcher(i), 3);`);
    lines.push(`}`);
    lines.push(``);
  }
  if (uses.has("duration")) {
    lines.push(`export function ttlMs(spec) {`);
    lines.push(`  return u.parseDuration(spec);`);
    lines.push(`}`);
    lines.push(``);
  }
  if (uses.has("render")) {
    lines.push(`export function subject(order) {`);
    lines.push(`  return u.render("Order {{id}} for {{customer.name}}", order);`);
    lines.push(`}`);
    lines.push(``);
  }
  lines.push(`export function slug(s) {`);
  lines.push(`  return u.slugify(s);`);
  lines.push(`}`);

  const checks = [];
  checks.push(`import assert from "node:assert/strict";`);
  checks.push(`import * as svc from "./index.js";`);
  checks.push(``);
  checks.push(`assert.equal(svc.libVersion.split(".")[0], "2", "service must run on acme-utils 2.x (got " + svc.libVersion + ")");`);
  checks.push(`assert.equal(svc.slug("Hello, World!"), "hello-world");`);
  if (uses.has("money")) {
    checks.push(`assert.equal(svc.priceLabel(123456, "USD"), "$1,234.56");`);
    checks.push(`assert.equal(svc.priceLabel(500, "EUR"), "€5.00");`);
  }
  if (uses.has("retry")) {
    checks.push(`{`);
    checks.push(`  let calls = 0;`);
    checks.push(`  const out = await svc.fetchWithRetry(async () => { calls++; if (calls < 3) throw new Error("flaky"); return "ok"; });`);
    checks.push(`  assert.equal(out, "ok");`);
    checks.push(`  assert.equal(calls, 3, "must retry up to 3 attempts total");`);
    checks.push(`}`);
  }
  if (uses.has("duration")) {
    checks.push(`assert.equal(svc.ttlMs("90s"), 90000);`);
    checks.push(`assert.equal(svc.ttlMs("2h"), 7200000);`);
  }
  if (uses.has("render")) {
    checks.push(`assert.equal(svc.subject({ id: "A1", customer: { name: "Dana" } }), "Order A1 for Dana");`);
    checks.push(`assert.equal(svc.subject({ id: "A2", customer: {} }), "Order A2 for ", "missing keys render empty");`);
  }
  checks.push(``);
  checks.push(`console.log("ok ${name}");`);

  return {
    "index.js": lines.join("\n") + "\n",
    "check.mjs": checks.join("\n") + "\n",
    "deps.json": JSON.stringify({ "acme-utils": "1.4.2" }, null, 2) + "\n",
  };
}

const services = names.map((name) => {
  const n = 2 + Math.floor(rand() * 3); // 2..4 features
  const shuffled = [...FEATURES].sort(() => rand() - 0.5);
  return { name, features: shuffled.slice(0, n) };
});

for (const s of services) {
  const dir = join(workspace, "services", s.name);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(serviceFiles(s.name, s.features))) {
    writeFileSync(join(dir, file), content);
  }
}

// batches by blast radius (round robin into 3 batches, deterministic)
const batches = [[], [], []];
names.forEach((n, i) => batches[i % 3].push(n));

// hidden oracle: which services degrade on canary, which CI runs flake once
const shuffledNames = [...names].sort(() => rand() - 0.5);
const degrade = shuffledNames.slice(0, badCount).sort();
const flaky = shuffledNames.filter((n) => !degrade.includes(n)).filter(() => rand() < 0.3).sort();

writeFileSync(
  join(workspace, "RELEASE.md"),
  `# Release train: ACME-2026-0917

All services in \`services/\` depend on \`vendor/acme-utils-1.4.2\`, which carries advisory
ACME-2026-0917. Every service must be moved to \`vendor/acme-utils-2.0.0\` (see its MIGRATION.md),
pass CI, be approved, canary-deployed, watched, and then promoted or rolled back.

## Batches (approval is per batch, in this order)

- batch-1: ${batches[0].join(", ")}
- batch-2: ${batches[1].join(", ")}
- batch-3: ${batches[2].join(", ")}

## Policy

1. A service may only be canaried after its CI run is green at version 2.0.0 AND its batch is approved.
2. A canary must be observed for the full canary window before promotion.
3. If a service's error rate exceeds 5% during the canary window it must be rolled back, not promoted.
4. Every deploy call must carry an idempotencyKey. Duplicate effects are release failures.
5. After the last promotion, wait the follow-up window, re-read every service's state, and post
   exactly one summary to the \`releases\` channel.
6. Nobody will be at the keyboard. Do not depend on a human relaunching anything.

Endpoints, windows, and payloads are at $WORLD_URL (default http://world:4747 in Harbor, http://127.0.0.1:4747 locally).
`,
);

mkdirSync(dirname(oracleOut), { recursive: true });
const vendor2Hash = createHash("sha256")
  .update(readFileSync(join(workspace, "vendor/acme-utils-2.0.0/index.js")))
  .update(readFileSync(join(workspace, "vendor/acme-utils-2.0.0/package.json")))
  .digest("hex");
writeFileSync(
  oracleOut,
  JSON.stringify({ seed, services: names, featuresByService: Object.fromEntries(services.map((s) => [s.name, s.features])), vendor2Hash, batches, degrade, flaky }, null, 2) + "\n",
);

writeFileSync(join(workspace, ".gitignore"), "node_modules\n");

console.log(`workspace  -> ${workspace}`);
console.log(`services   -> ${names.length}  (batches ${batches.map((b) => b.length).join("/")})`);
console.log(`oracle     -> ${oracleOut}  (degrade: ${degrade.join(", ")}; flaky CI: ${flaky.join(", ") || "none"})`);
