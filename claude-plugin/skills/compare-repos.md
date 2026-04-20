---
name: compare-stars
description: Compare star authenticity between multiple GitHub repositories. Useful for evaluating competing projects or checking if a trending repo has organic growth.
user_invocable: true
arguments:
  - name: repos
    description: "Comma-separated list of GitHub repositories in owner/repo format"
    required: true
---

# RealStars - Compare Repository Star Authenticity

Compare star authenticity across multiple GitHub repositories side by side.

## Input

Repositories: `{{ repos }}`

## Process

1. Parse the comma-separated list of repos
2. For each repo, run the same analysis as the `check-stars` skill:
   - Fetch repo metrics via `gh api repos/{owner}/{repo}`
   - Compute fork/star and watcher/star ratios
   - Sample 30+ stargazer profiles and analyze quality
   - Compute trust score (0-100)

3. Present a comparison table:

```
## RealStars Comparison

| Metric | {repo1} | {repo2} | {repo3} |
|--------|---------|---------|---------|
| Stars | ... | ... | ... |
| Trust Grade | A (92) | C (45) | B (71) |
| Fork/Star Ratio | 0.182 | 0.021 | 0.095 |
| Watcher/Star Ratio | 0.012 | 0.0008 | 0.007 |
| Zero-repo stargazers | 4% | 61% | 15% |
| Zero-follower stargazers | 8% | 72% | 22% |
| Ghost accounts | 1% | 24% | 6% |

### Analysis
{Brief narrative comparing the repos, noting any suspicious patterns}

### Disclaimer
Heuristic analysis based on CMU StarScout (ICSE 2026) methodology.
Statistical patterns, not definitive proof of manipulation.
```

Run analyses in parallel where possible (multiple `gh api` calls).
