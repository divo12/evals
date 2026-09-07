# release-train

An ITSMBench-shaped task for **Scenario 5**: the same model (Claude) orchestrating a long,
gated, side-effecting release either as a dynamic workflow / plain agent from the terminal, or as
a Trigger.dev project it writes itself. Same world, same ledger, same grader.

```
tasks/release-train/
├── task.toml                  task metadata, arms, faults, invariants
├── instruction.md             what the agent gets. Point Claude at this.
├── run.sh                     operator helper: up / reset / grade / fault
├── environment/
│   ├── generate.mjs           builds workspace/ (real services + real vendored libs) and oracle.json
│   ├── world.mjs              one process = CI + approver + deploy + metrics + chat; appends ledger.jsonl
│   ├── oracle.json            hidden: which services degrade on canary, which CI runners flake
│   └── ledger.jsonl           everything the world observed (the only grading input)
├── tests/
│   ├── test.sh                verifier -> tests/reward.txt (0|1) + tests/results.json
│   └── grade.mjs
├── solution/
│   ├── reference-naive.mjs    harness self-test: in-memory polling script; passes only if never killed
│   └── trigger-notes.md       what the Trigger.dev arm needs to look like
└── workspace/                 generated; the agent's sandbox (services/, vendor/, RELEASE.md, orchestrator/)
```

Dependencies: Node ≥ 20 and bash. No npm packages, no Docker. The Trigger.dev arm additionally
needs a Trigger.dev account and `npx trigger.dev` (the agent sets that up inside `workspace/orchestrator/`).

## Why this task is hard for a session-bound agent and fine for Trigger.dev

| Stage | What the world does | Why Claude-in-a-terminal struggles | What Trigger.dev gives |
|---|---|---|---|
| CI | Runs `check.mjs` for real after a 7-minute wait; ~30% of first runs flake | Nothing to do for minutes → stall watchdog / context burn; flake needs a retry that survives | `wait.forToken` completed by the world's callback, or `retry` + `wait.for` |
| Approvals | Decision arrives 25–55 min later per batch, only via callback or poll | No inbound events; polling for an hour eats tokens; session dies → approval token lost | `wait.forToken()` — run suspends, callback completes it, zero compute while waiting |
| Canary | 30-min window; 2 services start failing 15 min in; must roll back promptly | Needs a real clock and periodic checks across a long window; a killed process forgets `canaryAt` | `wait.for({minutes})` in a loop, or a scheduled child task; state is in the run |
| Deploys | Non-idempotent side effects | A resumed agent re-canaries / re-promotes | `idempotencyKey` on `triggerAndWait`, keys derived from `(service, stage)` |
| Follow-up | Exactly `followUp` after the *last* promotion, exactly once | 60 minutes of nothing, then a precisely timed action, in a session nobody is watching | `wait.for` / `wait.until` on the last promotion timestamp |
| Faults | Operator SIGKILLs the orchestrator, sleeps the laptop | Work lost; human relaunch → `reward=0` | Run is checkpointed; resumes on another worker; ledger unaffected |

None of this is exotic. It is a normal Tuesday for a release engineer, which is what makes it a
fair benchmark rather than a puzzle.

## Running it

```bash
cd tasks/release-train

# 1. bring up the world (regenerates workspace + ledger each time)
./run.sh up smoke          # ~5 min end to end, to check plumbing
./run.sh up compressed     # ~3 h, the graded profile
./run.sh up real           # ~1.5 d

# 2. point the agent at it (separate terminal)
#    Arm A — Claude directly:
cd workspace && claude
#    paste ../instruction.md, add: "arm: claude"
#    Arm B — Claude writing Trigger.dev:
cd workspace && claude
#    paste ../instruction.md, add: "arm: trigger. Build the orchestrator as a Trigger.dev v4 project in
#    workspace/orchestrator/, run it with `npx trigger.dev@latest dev`, and trigger the run."

# 3. inject the planned faults during the graded run, log each one
./run.sh fault sigkill "killed orchestrator during batch-2 canary"
./run.sh fault sleep "closed laptop 10 min during batch-3 approval wait"

# 4. grade
./run.sh grade             # prints PASS/FAIL per invariant; tests/results.json has the numbers
```

Ledger-only grading means the agent's own report is irrelevant; only what actually hit CI, the
approver, the deploy system and chat counts.

## Fault schedule for the graded run

Apply the same three to both arms, at the same phase:

1. `kill -9` the orchestrator process (the `claude` process, or the `trigger dev` CLI / worker) ~10 min into batch-1's canary window.
2. Put the machine to sleep for 10 min while batch-2's approval is pending.
3. `kill -9` the orchestrator ~20 min after the last promotion, during the follow-up wait.

If the arm cannot continue on its own after a fault, the operator relaunches it with the same
instruction. The relaunch is recorded (`POST /run/start` count) and sets `reward=0`;
`assistedReward` still shows whether the invariants were eventually met.

## Sanity check of the harness

`solution/reference-naive.mjs` is a straight-line Node script that passes under `smoke` with no
faults (reward 1). Kill it once during batch-1's canary and relaunch: it reruns CI, re-requests
approval (the world returns the existing one), its idempotency keys dedupe the canaries — then it
tries to promote `billing`, which the first incarnation had already rolled back, gets a 409 and
crashes. Its beliefs no longer match the world. Result: `relaunches=1, reward=0, assistedReward=0`.
That is the baseline both arms are measured against.

## Knobs

- `SEED`, `SERVICES` (≤30), `BAD` on `generate.mjs` — bigger trains, more degraded canaries.
- `PROFILE`, `PORT`, `WORLD_URL`, `KEEP_LEDGER` on `world.mjs`.
- Windows live in `PROFILES` inside `world.mjs`; the grader reads them from the ledger's `world.start` record, so changing them needs no grader edits.
