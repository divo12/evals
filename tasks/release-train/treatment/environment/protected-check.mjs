#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [serviceDir, featuresJson, expectedVendorHash] = process.argv.slice(2);
const features = new Set(JSON.parse(featuresJson ?? "[]"));
const sourcePath = join(serviceDir, "index.js");
assert.ok((await stat(sourcePath)).size <= 1_000_000, "service source exceeds 1 MB");
const source = await readFile(sourcePath, "utf8");
const vendorDir = join(serviceDir, "../../vendor/acme-utils-2.0.0");
const vendorHash = createHash("sha256")
  .update(await readFile(join(vendorDir, "index.js")))
  .update(await readFile(join(vendorDir, "package.json")))
  .digest("hex");

assert.equal(vendorHash, expectedVendorHash, "acme-utils-2.0.0 was modified");
assert.match(source, /acme-utils-2\.0\.0/);
if (/\b(process|fetch|Bun|Deno)\b|node:|\bimport\s*\(/.test(source)) {
  throw new Error("service source uses capabilities forbidden in protected CI");
}

const svc = await import(`${pathToFileURL(join(serviceDir, "index.js")).href}?ci=${Date.now()}`);
assert.equal(svc.libVersion, "2.0.0");
assert.equal(svc.slug("Hello, World!"), "hello-world");

if (features.has("money")) {
  assert.equal(svc.priceLabel(123456, "USD"), "$1,234.56");
  assert.equal(svc.priceLabel(500, "EUR"), "€5.00");
}
if (features.has("retry")) {
  let calls = 0;
  assert.equal(await svc.fetchWithRetry(async () => {
    calls += 1;
    if (calls < 3) throw new Error("flaky");
    return "ok";
  }), "ok");
  assert.equal(calls, 3);
}
if (features.has("duration")) {
  assert.equal(svc.ttlMs("90s"), 90000);
  assert.equal(svc.ttlMs("2h"), 7200000);
}
if (features.has("render")) {
  assert.equal(svc.subject({ id: "A1", customer: { name: "Dana" } }), "Order A1 for Dana");
  assert.equal(svc.subject({ id: "A2", customer: {} }), "Order A2 for ");
}

console.log(JSON.stringify({ ok: true }));
