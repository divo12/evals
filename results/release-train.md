# Release Train Results

| Metric | Control - Codex with Dynamic Workflow | Treatment - Codex with Trigger.dev |
|---|---:|---:|
| Model | `gpt-5.6-sol` — high reasoning | `gpt-5.6-sol` — high reasoning |
| Reward | **1.0** | **1.0** |
| Exceptions | 0 | 0 |
| Total runtime | 826s (13m46s) | 930s (15m30s) |
| Codex active time | 645s (10m45s) | 533s (8m53s) |
| Verifier wait | <1s | 307s (5m07s) |
| World ledger span | 594s | 316s |
| Codex sessions | 4 (parent + 3 subagents) | 1 author session |
| Input tokens | 1,212,121 | 467,034 |
| Cached input tokens | 1,120,512 | 416,768 |
| Output tokens | 17,490 | 14,307 |
| Estimated cost | **$1.1644** | **$0.6539** |
| CI polls | 324 | 0 |
| Approval polls | 204 | 0 |
| Trigger callbacks | N/A | 19 |

Treatment was approximately 44% cheaper and used 17% less Codex-active time.
Its total runtime was approximately 13% longer because the verifier waited for
Trigger.dev after Codex exited.

Control usage was reconstructed by summing the parent and three subagent
rollouts. The reconstruction restores an over-redacted digit from the retained
artifacts and is validated because the last subagent independently reproduces
Harbor's reported `$0.1725632` cost exactly. Costs use GPT-5.6 Sol standard
rates recorded on 2026-09-08: $4/M uncached input, $0.40/M cached input, and
$20/M output.

These are single successful trials and establish reachability, not a stable
performance ranking.
