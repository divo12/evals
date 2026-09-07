#!/usr/bin/env node
import { createServer } from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ledgerPath = process.env.LEDGER_PATH ?? "/hidden/ledger.jsonl";
const port = Number(process.env.TRACKER_PORT ?? 9410);
const bind = process.env.BIND ?? "0.0.0.0";
const verifierToken = process.env.VERIFIER_TOKEN ?? "";
let seq = 0;

mkdirSync(dirname(ledgerPath), { recursive: true });
writeFileSync(ledgerPath, "");

const server = createServer((req, res) => {
  const json = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/internal/ledger") {
    const got = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!verifierToken || got !== verifierToken) return json(404, { error: "not found" });
    const raw = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : "";
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    res.end(raw);
    return;
  }

  if (req.method === "POST" && url.pathname === "/tickets") {
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

server.listen(port, bind, () => {
  console.log(`tracker http://${bind}:${port}  ledger ${ledgerPath}`);
});
