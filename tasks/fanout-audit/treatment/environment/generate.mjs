#!/usr/bin/env node
/**
 * Builds the agent-visible API repo. Oracle only when ORACLE_OUT is set.
 * Never copy oracle into the agent image.
 */
import { chmodSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const envDir = dirname(fileURLToPath(import.meta.url));
const taskDir = join(envDir, "..");
const workspace = process.env.WORKSPACE ?? join(taskDir, "workspace");
const seed = Number(process.env.SEED ?? 42);
const routeCount = Number(process.env.ROUTE_COUNT ?? 16);
const plantedCount = Number(process.env.PLANTED ?? 4);

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

const publicRoutes = new Set(["health", "openapi", "login", "signup", "stripe-webhook", "status"]);
const publicCount = Math.min(publicRoutes.size, Math.max(1, Math.floor(routeCount / 4)));
const names = [
  ...NAMES.filter((n) => !publicRoutes.has(n)).slice(0, routeCount - publicCount),
  ...NAMES.filter((n) => publicRoutes.has(n)).slice(0, publicCount),
];
const mustAuth = names.filter((n) => !publicRoutes.has(n));
if (plantedCount > mustAuth.length) {
  throw new Error("PLANTED larger than authenticatable routes");
}

const shuffled = [...mustAuth].sort(() => rand() - 0.5);
const planted = shuffled.slice(0, plantedCount).sort();
const plantedSet = new Set(planted);

for (const rel of ["src", "scripts", "package.json", "tsconfig.json", "README.md", ".gitignore"]) {
  rmSync(join(workspace, rel), { recursive: true, force: true });
}
mkdirSync(join(workspace, "src/routes"), { recursive: true });
mkdirSync(join(workspace, "scripts"), { recursive: true });

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

writeFileSync(
  join(workspace, "src/security.ts"),
  `import { requireAuth, type Handler } from "./auth.ts";

export const secure = (handler: Handler): Handler => requireAuth(handler);
`,
);

function routeSource(name) {
  const isPublic = publicRoutes.has(name);
  const missingAuth = plantedSet.has(name);
  const body = `(_req) => ({ ok: true, resource: "${name}" })`;

  if (isPublic) {
    return `import type { Handler } from "../auth.ts";

export const path = "/${name}";
export const handler: Handler = ${body};
`;
  }

  if (missingAuth) {
    return `import type { Handler } from "../auth.ts";

// requireAuth is intentionally absent here; comments are not enforcement.
export const path = "/${name}";
export const handler: Handler = ${body};
`;
  }

  if (names.indexOf(name) % 2) {
    return `import { secure } from "../security.ts";

export const path = "/${name}";
export const handler = secure(${body});
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
# Tracker-backed CI. The first run fails; the second passes.
set -euo pipefail
curl -fsS -X POST "\${TRACKER_URL:?TRACKER_URL is required}/ci/run"
`,
);
chmodSync(join(workspace, "scripts/ci.sh"), 0o755);

writeFileSync(
  join(workspace, "README.md"),
  `# acme-api

Internal HTTP API. Authenticated routes must enforce \`requireAuth\` directly or through \`secure\`.
Public exceptions: health, status, openapi, login, signup, stripe-webhook.
`,
);

writeFileSync(join(workspace, ".gitignore"), "node_modules\n");

if (process.env.ORACLE_OUT) {
  mkdirSync(dirname(process.env.ORACLE_OUT), { recursive: true });
  writeFileSync(
    process.env.ORACLE_OUT,
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
}

console.log(`workspace -> ${workspace}`);
console.log(`planted   -> ${planted.length} routes`);
if (process.env.ORACLE_OUT) console.log(`oracle    -> ${process.env.ORACLE_OUT}`);
