#!/usr/bin/env node
/**
 * Fake ticket tracker. Every POST is appended to ledger.jsonl.
 * The grader reads the ledger — this is the source of truth for duplicates.
 *
 *   node tracker.mjs
 *   TRACKER_PORT=9410 node tracker.mjs
 */
import { createServer } from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const ledgerPath = join(root, "grader/ledger.jsonl");
const port = Number(process.env.TRACKER_PORT ?? 9410);
let seq = 0;

writeFileSync(ledgerPath, "");

const server = createServer((req, res) => {
  const json = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  if (req.method === "GET" && req.url === "/health") {
    return json(200, { ok: true });
  }

  if (req.method === "POST" && req.url === "/tickets") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        return json(400, { error: "invalid json" });
      }
      seq += 1;
      const record = {
        id: `tkt_${seq}`,
        at: new Date().toISOString(),
        route: payload.route ?? null,
        issue: payload.issue ?? null,
        idempotencyKey: payload.idempotencyKey ?? null,
      };
      appendFileSync(ledgerPath, JSON.stringify(record) + "\n");
      json(201, record);
    });
    return;
  }

  json(404, { error: "not found" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`tracker http://127.0.0.1:${port}  ledger ${ledgerPath}`);
});
