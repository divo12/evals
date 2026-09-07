#!/usr/bin/env node
const secret = process.env.TRIGGER_SECRET_KEY;
const taskId = process.env.TRIGGER_TASK_ID ?? "acme-release-train";
if (!secret) {
  console.error("infra: TRIGGER_SECRET_KEY is not set");
  process.exit(2);
}

const headers = {
  authorization: `Bearer ${secret}`,
  accept: "application/json",
  "content-type": "application/json",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const terminal = new Set(["COMPLETED", "FAILED", "CANCELED", "CRASHED", "SYSTEM_FAILURE", "EXPIRED", "TIMED_OUT"]);

async function readJson(res) {
  const text = await res.text();
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    throw new Error(`expected json, got ${res.status} ${type} ${text.slice(0, 160)}`);
  }
  return JSON.parse(text);
}

async function triggerOnce(id) {
  const res = await fetch(`https://api.trigger.dev/api/v1/tasks/${encodeURIComponent(id)}/trigger`, {
    method: "POST",
    headers,
    body: JSON.stringify({ payload: {} }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, text };
  }
  return { ok: true, json: await readJson(res) };
}

async function retrieveRun(runId) {
  const res = await fetch(`https://api.trigger.dev/api/v3/runs/${encodeURIComponent(runId)}`, { headers });
  return readJson(res);
}

function isExecutorRace(status, run) {
  const blob = JSON.stringify(run.error ?? run.output ?? run);
  return (
    status === "SYSTEM_FAILURE" &&
    /COULD_NOT_FIND_EXECUTOR|superseded worker|PENDING_VERSION/i.test(blob)
  );
}

async function triggerWhenIndexed(id) {
  for (let i = 0; i < 72; i++) {
    try {
      const result = await triggerOnce(id);
      if (result.ok && (result.json.id || result.json.runId)) {
        return result.json;
      }
      console.log(`waiting for worker to index ${id}: ${result.status} ${String(result.text).slice(0, 160)}`);
    } catch (e) {
      console.log(`waiting for worker to index ${id}: ${e.message}`);
    }
    await sleep(5000);
  }
  return null;
}

let lastError = "no attempt";
for (let attempt = 1; attempt <= 6; attempt++) {
  const handle = await triggerWhenIndexed(taskId);
  if (!handle) {
    lastError = `infra: could not trigger ${taskId}`;
    break;
  }

  const runId = handle.id ?? handle.runId;
  console.log(`triggered ${taskId} ${runId} (attempt ${attempt})`);

  let raced = false;
  for (let i = 0; i < 200; i++) {
    const run = await retrieveRun(runId);
    const status = run.status ?? run.run?.status;
    console.log(`run ${runId} ${status}`);
    if (status === "COMPLETED") {
      console.log("parent completed");
      process.exit(0);
    }
    if (terminal.has(status)) {
      lastError = `run ended ${status} ${JSON.stringify(run.error ?? run.output ?? {})}`;
      if (isExecutorRace(status, run) && attempt < 6) {
        console.log(`executor race, retrying: ${lastError}`);
        raced = true;
        break;
      }
      console.error(lastError);
      process.exit(1);
    }
    await sleep(5000);
  }
  if (raced) {
    await sleep(15000);
    continue;
  }
  lastError = "infra: timed out waiting for parent run";
}

console.error(lastError);
process.exit(2);
