import { task } from "@trigger.dev/sdk";

/** Seed task so `trigger dev` indexes a version on boot. Not the audit solution. */
export const workerReady = task({
  id: "worker-ready",
  run: async () => ({ ok: true as const }),
});
