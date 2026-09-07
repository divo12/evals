import { task } from "@trigger.dev/sdk";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { auditRoute } from "./audit-route";

const workspace = process.env.WORKSPACE ?? "/app";
const tracker = process.env.TRACKER_URL ?? "http://tracker:9410";

export const fanoutAudit = task({
  id: "fa-fanout-audit",
  maxDuration: 600,
  retry: { maxAttempts: 1 },
  run: async () => {
    const files = readdirSync(join(workspace, "src/routes"))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, ""));

    const payloads = files.map((route) => ({ payload: { route } }));
    let batch = await auditRoute.batchTriggerAndWait(payloads);

    const findings: { confirmed: boolean; route: string; reason: string; runId: string }[] = [];
    for (let i = 0; i < batch.runs.length; i++) {
      let run = batch.runs[i];
      if (!run.ok) {
        run = await auditRoute.triggerAndWait(payloads[i].payload);
      }
      if (!run.ok) {
        throw new Error(`child failed ${files[i]} ${JSON.stringify(run.error ?? run)}`);
      }
      findings.push({
        confirmed: run.output.confirmed,
        route: run.output.route,
        reason: run.output.reason,
        runId: run.id,
      });
    }

    const confirmed = findings.filter((f) => f.confirmed).map((f) => f.route);
    const rejected = findings.filter((f) => !f.confirmed).map((f) => f.route);
    const tickets: string[] = [];

    for (const f of findings.filter((x) => x.confirmed)) {
      const res = await fetch(`${tracker}/tickets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          route: f.route,
          issue: "missing requireAuth",
          idempotencyKey: f.route,
          triggerRunId: f.runId,
        }),
      });
      if (!res.ok) throw new Error(`ticket ${f.route} ${res.status}`);
      const body = (await res.json()) as { id: string };
      tickets.push(body.id);
    }

    writeFileSync(
      join(workspace, "report.json"),
      JSON.stringify({ confirmed, rejected, tickets }, null, 2) + "\n",
    );

    const ci = () =>
      spawnSync("bash", [join(workspace, "scripts/ci.sh")], { stdio: "inherit", env: process.env });
    let status = ci().status;
    if (status !== 0) status = ci().status;
    if (status !== 0) throw new Error("ci failed twice");

    return { confirmed, rejected, tickets };
  },
});
