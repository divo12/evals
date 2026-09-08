#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = new URL(".", import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), "release-ci-"));
const workspace = join(dir, "workspace");
const oraclePath = join(dir, "oracle.json");
const generated = spawnSync(process.execPath, [join(root, "control/environment/generate.mjs")], {
  env: { ...process.env, WORKSPACE: workspace, ORACLE_OUT: oraclePath },
});
assert.equal(generated.status, 0, generated.stderr.toString());

const service = "billing";
const serviceDir = realpathSync(join(workspace, "services", service));
const vendorDir = realpathSync(join(workspace, "vendor/acme-utils-2.0.0"));
const check = realpathSync(join(root, "control/environment/protected-check.mjs"));
const oracle = JSON.parse(readFileSync(oraclePath, "utf8"));
const features = oracle.featuresByService[service];
const run = () => spawnSync(process.execPath, [
  "--experimental-permission",
  `--allow-fs-read=${serviceDir}`,
  `--allow-fs-read=${vendorDir}`,
  `--allow-fs-read=${check}`,
  check,
  serviceDir,
  JSON.stringify(features),
  oracle.vendor2Hash,
], { cwd: serviceDir, env: { PATH: process.env.PATH ?? "" } });

writeFileSync(join(serviceDir, "check.mjs"), "process.exit(0);\n");
assert.notEqual(run().status, 0, "protected CI trusted the editable check.mjs");

const sourcePath = join(serviceDir, "index.js");
const migrated = readFileSync(sourcePath, "utf8")
  .replace("acme-utils-1.4.2", "acme-utils-2.0.0")
  .replace(/u\.formatMoney\(([^,]+), ([^)]+)\)/g, "u.formatMoney({ amount: $1, currency: $2 })")
  .replace(/u\.retry\(([^,]+), 3\)/g, "u.retry($1, { attempts: 3 })")
  .replaceAll("u.parseDuration(", "u.durationMs(");
writeFileSync(sourcePath, migrated);
writeFileSync(join(serviceDir, "deps.json"), JSON.stringify({ "acme-utils": "2.0.0" }));
const result = run();
assert.equal(result.status, 0, result.stderr.toString());
writeFileSync(join(vendorDir, "package.json"), "{}\n");
assert.notEqual(run().status, 0, "protected CI accepted a modified vendor package");
console.log("protected release CI checks passed");
