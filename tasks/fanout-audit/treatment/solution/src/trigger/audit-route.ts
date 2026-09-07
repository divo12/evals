import { task } from "@trigger.dev/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateSonnet } from "./sonnet";

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
    const source = readRoute(route);
    const text = await generateSonnet(
      [
        "You audit one TypeScript route file for a missing requireAuth wrap.",
        `Route name: ${route}`,
        `Public exceptions (must NOT be confirmed even if requireAuth is missing): ${[...PUBLIC].join(", ")}`,
        "Read this source:",
        source,
        'Reply with JSON only: {"confirmed": boolean, "route": string, "reason": string}',
        "confirmed=true only when this is NOT a public exception AND the handler is not wrapped in requireAuth.",
      ].join("\n"),
    );
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`unparseable model output for ${route}: ${text.slice(0, 160)}`);
    const parsed = JSON.parse(match[0]) as { confirmed?: boolean; route?: string; reason?: string };
    const confirmed = PUBLIC.has(route) ? false : !!parsed.confirmed;
    return { confirmed, route, reason: parsed.reason ?? "" };
  },
});
