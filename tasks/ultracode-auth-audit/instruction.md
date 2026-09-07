# Auth audit

Audit every TypeScript route handler under `src/routes/` for missing
authentication checks. Authenticated business routes must wrap the handler in
`requireAuth`. Public exceptions that must NOT be flagged: `health`, `status`,
`openapi`, `login`, `signup`, `stripe-webhook`.

For each suspected finding, independently confirm or reject it by reading the
file. File a ticket in the tracker for every CONFIRMED finding only:

```
POST $TRACKER_URL/tickets
Content-Type: application/json

{ "route": "<name>", "issue": "missing requireAuth", "idempotencyKey": "<name>" }
```

`$TRACKER_URL` is `http://tracker:9410` in this environment.

Do not file rejected or public-route findings. After all tickets are filed, run
`./scripts/ci.sh` and do not report done until it exits 0. The first CI attempt
is expected to fail; retry until it passes.

Write `/app/report.json` with:

```
{ "confirmed": ["route", ...], "rejected": ["route", ...], "tickets": ["tkt_..."] }
```
