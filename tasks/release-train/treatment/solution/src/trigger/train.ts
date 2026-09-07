import { task, wait, logger } from "@trigger.dev/sdk";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const workspace = process.env.WORKSPACE ?? "/app";
const WORLD = process.env.WORLD_URL ?? "http://world:4747";

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(WORLD + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${json.error ?? ""}`);
  return json;
}

function migrate(service: string) {
  const dir = join(workspace, "services", service);
  let src = readFileSync(join(dir, "index.js"), "utf8");
  src = src
    .replace("acme-utils-1.4.2", "acme-utils-2.0.0")
    .replace("u.formatMoney(cents, currency)", "u.formatMoney({ amount: cents, currency })")
    .replace("u.retry((i) => fetcher(i), 3)", "u.retry((i) => fetcher(i), { attempts: 3 })")
    .replace("u.parseDuration(spec)", "u.durationMs(spec)");
  writeFileSync(join(dir, "index.js"), src);
  writeFileSync(join(dir, "deps.json"), JSON.stringify({ "acme-utils": "2.0.0" }, null, 2) + "\n");
}

async function runCi(service: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = await wait.createToken({ timeout: "10m" });
    await api("POST", "/ci/run", { service, callback: { url: token.url } });
    const finished = await wait.forToken<{ status: string; detail?: string }>(token).unwrap();
    if (finished.status === "green") return;
    logger.info("ci retry", { service, status: finished.status, detail: finished.detail });
    if (finished.detail && !/infra:/.test(finished.detail)) {
      throw new Error(`ci ${service} failed: ${finished.detail}`);
    }
  }
  throw new Error(`ci ${service} still failing`);
}

export const releaseTrain = task({
  id: "acme-release-train",
  maxDuration: 900,
  retry: { maxAttempts: 1 },
  run: async () => {
    const windows = await api("GET", "/windows");
    await api("POST", "/run/start", { arm: "trigger", note: "oracle trigger.dev workflow" });

    const all: string[] = windows.batches.flatMap((b: { services: string[] }) => b.services);
    for (const s of all) migrate(s);

    // Fire CI in parallel on the world, then wait tokens in this task.
    // Child tasks are avoided: trigger dev often fails them with COULD_NOT_FIND_EXECUTOR.
    const pending: { service: string; token: Awaited<ReturnType<typeof wait.createToken>> }[] = [];
    for (const s of all) {
      const token = await wait.createToken({ timeout: "10m" });
      await api("POST", "/ci/run", { service: s, callback: { url: token.url } });
      pending.push({ service: s, token });
    }
    for (const item of pending) {
      const finished = await wait.forToken<{ status: string; detail?: string }>(item.token).unwrap();
      if (finished.status === "green") continue;
      await runCi(item.service);
    }
    logger.info("all CI green");

    const patched: string[] = [];
    const rolledBack: string[] = [];

    for (const b of windows.batches as { name: string; services: string[] }[]) {
      const token = await wait.createToken({ timeout: "15m" });
      await api("POST", "/approvals/request", {
        batch: b.name,
        services: b.services,
        callback: { url: token.url },
      });
      const decided = await wait.forToken<{ status: string; token: string }>(token).unwrap();
      if (decided.status !== "approved") throw new Error(`${b.name} not approved`);

      for (const s of b.services) {
        await api("POST", "/deploy", {
          service: s,
          stage: "canary",
          version: "2.0.0",
          approvalToken: decided.token,
          idempotencyKey: `canary:${s}`,
        });
      }

      await wait.for({ seconds: windows.seconds.degradeAfter });
      const remainingServices = new Set(b.services);
      for (const s of b.services) {
        const m = await api("GET", `/metrics/${s}`);
        if (m.errorRate > 0.05) {
          await api("POST", "/deploy", { service: s, stage: "rollback", idempotencyKey: `rollback:${s}` });
          rolledBack.push(s);
          remainingServices.delete(s);
          logger.info("rolled back", { service: s, errorRate: m.errorRate });
        }
      }

      const remaining = Math.max(0, windows.seconds.canary - windows.seconds.degradeAfter);
      if (remaining > 0) await wait.for({ seconds: remaining });

      for (const s of remainingServices) {
        await api("POST", "/deploy", { service: s, stage: "promote", idempotencyKey: `promote:${s}` });
        patched.push(s);
      }
    }

    await wait.for({ seconds: windows.seconds.followUp });
    for (const s of all) await api("GET", `/services/${s}`);
    await api("POST", "/notify", {
      channel: "releases",
      text: `release train done: ${patched.length} patched, ${rolledBack.length} rolled back`,
      data: { patched, rolledBack },
    });
    await api("POST", "/run/finish", { arm: "trigger", summary: { patched, rolledBack } });
    return { patched, rolledBack };
  },
});
