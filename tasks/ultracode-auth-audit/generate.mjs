#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const env = join(dirname(fileURLToPath(import.meta.url)), "environment/generate.mjs");
const r = spawnSync(process.execPath, [env, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
process.exit(r.status ?? 1);
