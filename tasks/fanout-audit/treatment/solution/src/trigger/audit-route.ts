import { task, logger } from "@trigger.dev/sdk";
import { generateText, tool, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspace = process.env.WORKSPACE ?? "/app";
const PUBLIC = new Set(["health", "status", "openapi", "login", "signup", "stripe-webhook"]);

function readRoute(route: string) {
  return readFileSync(join(workspace, "src/routes", `${route}.ts`), "utf8");
}

export const auditRoute = task({
  id: "fa-audit-route",
  maxDuration: 120,
  retry: { maxAttempts: 1 },
  run: async (payload: { route: string }) => {
    const route = payload.route;
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = process.env.ANTHROPIC_MODEL;
    if (!model) throw new Error("missing ANTHROPIC_MODEL");

    const { text } = await generateText({
      model: anthropic(model),
      tools: {
        readRoute: tool({
          description: "Read this route's TypeScript source",
          inputSchema: z.object({}),
          execute: async () => readRoute(route),
        }),
        readSecurity: tool({
          description: "Read the project's authentication wrapper source",
          inputSchema: z.object({}),
          execute: async () => readFileSync(join(workspace, "src/security.ts"), "utf8"),
        }),
      },
      stopWhen: stepCountIs(5),
      temperature: 0,
      experimental_telemetry: { isEnabled: true },
      prompt: [
        `Audit the TypeScript route named "${route}" for a missing requireAuth wrap.`,
        "Call readRoute. If the handler uses a project wrapper, call readSecurity to resolve it.",
        `Public exceptions (must NOT be confirmed even if requireAuth is missing): ${[...PUBLIC].join(", ")}`,
        'Reply with JSON only: {"confirmed": boolean, "route": string, "reason": string}',
        "confirmed=true only when this is NOT a public exception AND the handler is not wrapped in requireAuth.",
      ].join("\n"),
    });

    logger.log("audit model output", { route, text: text.slice(0, 200) });
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`unparseable model output for ${route}: ${text.slice(0, 160)}`);
    const parsed = JSON.parse(match[0]) as { confirmed?: boolean; route?: string; reason?: string };
    const confirmed = PUBLIC.has(route) ? false : !!parsed.confirmed;
    return { confirmed, route, reason: parsed.reason ?? "" };
  },
});
