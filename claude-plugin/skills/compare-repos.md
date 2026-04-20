---
name: compare-stars
description: Compare star authenticity between multiple GitHub repositories using all 13 detection signals. Useful for evaluating competing projects or checking if a trending repo has organic growth.
user_invocable: true
arguments:
  - name: repos
    description: "Comma-separated list of GitHub repositories in owner/repo format"
    required: true
---

# RealStars - Compare Repository Star Authenticity (13-Signal Analysis)

Compare star authenticity across multiple GitHub repositories side by side using all 13 weighted detection signals.

## Input

Repositories: `{{ repos }}`

## Process

1. Parse the comma-separated list of repos.

2. For each repo, run the full 13-signal analysis as defined in the `check-stars` skill:
   - Fetch repo metrics via `gh api repos/{owner}/{repo}`
   - Compute fork/star and watcher/star ratios (Signal 1)
   - Calculate community engagement: issues, PRs, contributors (Signal 2)
   - Fetch star timestamps and detect bursts/uniform spacing (Signal 3)
   - Sample 30-60 stargazer profiles and analyze quality (Signal 4)
   - Bin account creation dates into 2-week windows (Signal 5)
   - Analyze username entropy and bot patterns (Signal 6)
   - Check stargazer overlap via starred repos (Signal 7)
   - Look up cross-platform downloads if applicable (Signal 8)
   - Check geographic clustering from location fields (Signal 9)
   - Cross-reference star spikes with releases (Signal 10)
   - Compute weighted composite score (Signal 11)
   - Check known farm blocklist if available (Signal 12)
   - Note historical score for trend tracking (Signal 13)

3. Present a comparison table with all signals:

```
## RealStars Comparison

### Summary
| Metric | {repo1} | {repo2} | {repo3} |
|--------|---------|---------|---------|
| Stars | ... | ... | ... |
| Trust Grade | A (92) | C (45) | B (71) |
| Composite Score | 0.92 | 0.45 | 0.71 |

### Signal Breakdown
| Signal (Weight) | {repo1} | {repo2} | {repo3} |
|-----------------|---------|---------|---------|
| Star Timing (0.15) | 0.95 | 0.20 | 0.75 |
| Profile Quality (0.15) | 0.90 | 0.30 | 0.65 |
| Engagement Ratios (0.12) | 0.88 | 0.15 | 0.70 |
| Stargazer Overlap (0.12) | 0.92 | 0.25 | 0.80 |
| Account Clustering (0.10) | 0.95 | 0.10 | 0.85 |
| Community Health (0.08) | 0.85 | 0.40 | 0.60 |
| Username Patterns (0.08) | 0.90 | 0.35 | 0.75 |
| Cross-Platform (0.05) | 0.95 | N/A | 0.70 |
| Geographic (0.05) | 0.80 | 0.30 | N/A |
| Star Velocity (0.05) | 0.85 | 0.20 | 0.75 |
| Known Farms (0.05) | 1.00 | 0.50 | 1.00 |

### Key Metrics
| Metric | {repo1} | {repo2} | {repo3} |
|--------|---------|---------|---------|
| Fork/Star Ratio | 0.182 | 0.021 | 0.095 |
| Watcher/Star Ratio | 0.012 | 0.0008 | 0.007 |
| Zero-repo stargazers | 4% | 61% | 15% |
| Zero-follower stargazers | 8% | 72% | 22% |
| Ghost accounts | 1% | 24% | 6% |
| Default avatars | 3% | 55% | 12% |
| Zero-activity accounts | 2% | 48% | 10% |
| Max creation cluster | 5% | 42% | 12% |
| Bot-pattern usernames | 3% | 38% | 8% |
| Avg Jaccard overlap | 0.02 | 0.35 | 0.06 |
| Downloads/star/week | 2.4 | 0.003 | 1.1 |
| Top region % | 35% | 68% | N/A |
| Unexplained spikes | 0 | 4 | 1 |
| Known farm matches | 0 | 3 | 0 |

### Analysis
{Brief narrative comparing the repos, noting:
- Which repos have healthy organic patterns
- Which repos show concerning signals and why
- Whether differences are explainable (e.g., one is a viral single-purpose tool vs an established framework)
- Key differentiators between similar-scoring repos}

### Red Flags Summary
| Repo | Top Concerns |
|------|-------------|
| {repo1} | None — healthy profile |
| {repo2} | Ghost accounts 24%, creation clustering 42%, high overlap 0.35 |
| {repo3} | Slightly elevated zero-follower %, 1 unexplained spike |

### Disclaimer
Heuristic analysis based on CMU StarScout (ICSE 2026) methodology and extended signals.
Statistical patterns, not definitive proof of manipulation.
Different repo types (framework vs tool vs library) naturally have different baseline metrics.
```

Run analyses in parallel where possible (multiple `gh api` calls).

IMPORTANT: If rate-limited, note which repos received full analysis and which received partial. Prioritize completing all repos at quick-analysis depth over deep-diving a single repo.

IMPORTANT: When comparing repos, account for repo type differences. A CLI tool will naturally have different fork/star ratios than a web framework. Note these contextual factors in the analysis narrative.
