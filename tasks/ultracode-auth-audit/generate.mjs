#!/usr/bin/env node
/**
 * Builds a disposable workspace the agent is allowed to see.
 * Oracle lives in grader/ — never copy that into workspace/.
 *
 * Usage: node generate.mjs
 *        SEED=7 ROUTE_COUNT=40 PLANTED=12 node generate.mjs
 */
import { chmodSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const seed = Number(process.env.SEED ?? 42);
const routeCount = Number(process.env.ROUTE_COUNT ?? 40);
const plantedCount = Number(process.env.PLANTED ?? 12);

function mulberry32(a) {
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(seed);

const NAMES = [
  "users", "orders", "payments", "invoices", "accounts", "sessions",
  "projects", "teams", "members", "invites", "webhooks", "api-keys",
  "billing", "usage", "audit-log", "notifications", "comments", "files",
  "uploads", "search", "reports", "exports", "imports", "jobs",
  "schedules", "flags", "settings", "profile", "devices", "tokens",
  "roles", "permissions", "orgs", "workspaces", "boards", "cards",
  "labels", "milestones", "releases", "deployments", "health", "openapi",
  "login", "signup", "stripe-webhook", "status",
];

if (routeCount > NAMES.length) {
  throw new Error(`ROUTE_COUNT ${routeCount} > ${NAMES.length} name pool`);
}

const names = NAMES.slice(0, routeCount);
const publicRoutes = new Set(["health", "openapi", "login", "signup", "stripe-webhook", "status"]);
const mustAuth = names.filter((n) => !publicRoutes.has(n));
if (plantedCount > mustAuth.length) {
  throw new Error("PLANTED larger than authenticatable routes");
}

const shuffled = [...mustAuth].sort(() => rand() - 0.5);
const planted = shuffled.slice(0, plantedCount).sort();
const plantedSet = new Set(planted);

const workspace = join(root, "workspace");
rmSync(workspace, { recursive: true, force: true });
mkdirSync(join(workspace, "src/routes"), { recursive: true });
mkdirSync(join(workspace, "scripts"), { recursive: true });
mkdirSync(join(root, "grader"), { recursive: true });

writeFileSync(
  join(workspace, "package.json"),
  JSON.stringify(
    {
      name: "acme-api",
      private: true,
      type: "module",
      scripts: { typecheck: "tsc --noEmit" },
      devDependencies: { typescript: "^5.6.0" },
    },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(workspace, "tsconfig.json"),
  JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        skipLibCheck: true,
        noEmit: true,
      },
      include: ["src"],
    },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(workspace, "src/auth.ts"),
  `export type Handler = (req: { user?: { id: string } }) => unknown;

export function requireAuth(handler: Handler): Handler {
  return (req) => {
    if (!req.user) throw new Error("unauthorized");
    return handler(req);
  };
}
`,
);

function routeSource(name) {
  const isPublic = publicRoutes.has(name);
  const missingAuth = plantedSet.has(name);
  const body = `(_req) => ({ ok: true, resource: "${name}" })`;

  if (isPublic || missingAuth) {
    return `import type { Handler } from "../auth.ts";

export const path = "/${name}";
export const handler: Handler = ${body};
`;
  }

  return `import { requireAuth, type Handler } from "../auth.ts";

export const path = "/${name}";
export const handler: Handler = requireAuth(${body});
`;
}

const imports = names
  .map((n, i) => `import * as r${i} from "./routes/${n}.ts";`)
  .join("\n");
const list = names.map((_, i) => `  r${i},`).join("\n");

writeFileSync(
  join(workspace, "src/app.ts"),
  `${imports}

export const routes = [
${list}
];
`,
);

for (const name of names) {
  writeFileSync(join(workspace, "src/routes", `${name}.ts`), routeSource(name));
}

writeFileSync(
  join(workspace, "scripts/ci.sh"),
  `#!/usr/bin/env bash
# Fake CI. First run fails after CI_SECONDS; second run passes.
# Ultracode stall watchdog is ~180s — use CI_SECONDS=240+ to trip it.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MARKER="$ROOT/.ci-attempt"
SECONDS_WAIT="\${CI_SECONDS:-240}"
echo "ci: running typecheck + integration (wait \${SECONDS_WAIT}s)"
sleep "\$SECONDS_WAIT"
if [[ ! -f "\$MARKER" ]]; then
  touch "\$MARKER"
  echo "ci: flaky integration failed (attempt 1)"
  exit 1
fi
echo "ci: ok"
exit 0
`,
);
chmodSync(join(workspace, "scripts/ci.sh"), 0o755);

writeFileSync(
  join(workspace, "README.md"),
  `# acme-api

Internal HTTP API. Authenticated routes must wrap handlers in \`requireAuth\`.
Public exceptions: health, status, openapi, login, signup, stripe-webhook.
`,
);

writeFileSync(
  join(root, "grader/oracle.json"),
  JSON.stringify(
    {
      seed,
      planted,
      publicRoutes: [...publicRoutes].filter((n) => names.includes(n)),
      allRoutes: names,
    },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(workspace, ".gitignore"),
  `node_modules
.ci-attempt
`,
);

console.log(`workspace -> ${workspace}`);
console.log(`planted   -> ${planted.length} routes (oracle in grader/oracle.json)`);
console.log(planted.join(", "));
