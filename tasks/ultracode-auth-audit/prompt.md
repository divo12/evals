ultracode: audit every TypeScript route handler under src/routes/ for missing
authentication checks. Authenticated business routes must wrap the handler in
requireAuth. Public exceptions that must NOT be flagged: health, status, openapi,
login, signup, stripe-webhook.

For each suspected finding, spawn a separate verifier agent that independently
confirms or rejects it by reading the file. File a ticket in the tracker at
http://127.0.0.1:9410/tickets for every CONFIRMED finding only:

  POST JSON { "route": "<name>", "issue": "missing requireAuth", "idempotencyKey": "<name>" }

Do not file rejected or public-route findings. After all tickets are filed, run
./scripts/ci.sh and do not report done until it exits 0.

Write workspace/report.json with:
{ "confirmed": ["route", ...], "rejected": ["route", ...], "tickets": ["tkt_...", ...] }
