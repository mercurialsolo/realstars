---
name: check-stars
description: Analyze a GitHub repository for fake stars. Use when the user asks to check, verify, or fact-check GitHub stars for any repo. Accepts owner/repo or full GitHub URLs.
user_invocable: true
arguments:
  - name: repo
    description: "GitHub repository in owner/repo format or a GitHub URL"
    required: true
---

# RealStars - GitHub Star Fact Checker

You are analyzing a GitHub repository for signs of fake/purchased stars, based on the CMU StarScout (ICSE 2026) research methodology that identified 6 million fake stars across 18,617 repositories.

## Input

Repository: `{{ repo }}`

## Step 1: Extract repo owner/name

Parse the input. It may be:
- `owner/repo` format
- A GitHub URL like `https://github.com/owner/repo`
- Just a repo name (ask the user for the owner)

## Step 2: Fetch repository metrics

Run these commands to gather data. Use `gh` CLI (already authenticated):

```bash
# Get repo metadata (stars, forks, watchers, age)
gh api repos/{owner}/{repo} --jq '{
  stars: .stargazers_count,
  forks: .forks_count,
  watchers: .subscribers_count,
  open_issues: .open_issues_count,
  created_at: .created_at,
  description: .description,
  archived: .archived,
  topics: .topics
}'
```

## Step 3: Compute engagement ratios

Calculate these key ratios:

1. **Fork-to-Star Ratio** = forks / stars
   - Organic average: ~0.160
   - Suspicious: < 0.05
   - Highly suspicious: < 0.02
   - Per CMU research: "Any repository with a fork-to-star ratio below 0.05 and more than 10,000 stars warrants scrutiny"

2. **Watcher-to-Star Ratio** = watchers (subscribers) / stars
   - Healthy range: 0.005 - 0.030
   - Suspicious: < 0.005
   - Highly suspicious: < 0.001

## Step 4: Sample stargazer profiles

For repos with 50+ stars, sample stargazer profiles to check quality:

```bash
# Get stargazers from beginning of list
gh api "repos/{owner}/{repo}/stargazers?per_page=30&page=1" --jq '.[].login'

# Get stargazers from middle (calculate page based on total stars)
gh api "repos/{owner}/{repo}/stargazers?per_page=30&page={middle_page}" --jq '.[].login'

# Get stargazers from end
gh api "repos/{owner}/{repo}/stargazers?per_page=30&page={last_page}" --jq '.[].login'
```

Then for each sampled user (aim for 30-60 profiles), check:

```bash
# Check individual stargazer profile
gh api "users/{username}" --jq '{
  login: .login,
  public_repos: .public_repos,
  followers: .followers,
  following: .following,
  bio: .bio,
  created_at: .created_at
}'
```

Measure:
- **% with zero public repos** (organic: 2-6%, manipulated: 32-81%)
- **% with zero followers** (organic: 5-12%, manipulated: 52-81%)
- **% ghost accounts** (zero repos + zero followers + no bio) (organic: ~1%, manipulated: 19-28%)
- **Median account age** (fake accounts often aged but functionally empty)
- **Average public repos and followers**

## Step 5: Compute Trust Score

Score from 0-100 where 100 = very likely organic:

| Signal | Threshold | Score Impact |
|--------|-----------|-------------|
| Fork/star < 0.02 | Very low | -30 |
| Fork/star < 0.05 | Low | -20 |
| Watcher/star < 0.001 | Very low | -20 |
| Watcher/star < 0.005 | Low | -10 |
| Zero-repo stargazers > 50% | High | -25 |
| Zero-repo stargazers > 20% | Elevated | -12 |
| Zero-follower stargazers > 40% | High | -20 |
| Zero-follower stargazers > 15% | Elevated | -10 |
| Ghost accounts > 15% | High | -20 |
| Ghost accounts > 5% | Elevated | -8 |

Grade the score:
- **A (80-100)**: Likely Organic
- **B (60-79)**: Mostly Organic
- **C (40-59)**: Some Suspicious Signals
- **D (20-39)**: Likely Manipulated
- **F (0-19)**: Highly Suspicious

## Step 6: Present the report

Format the results as a clear report:

```
## RealStars Analysis: {owner}/{repo}

### Trust Score: {grade} ({score}/100) - {label}

### Repository Metrics
| Metric | Value |
|--------|-------|
| Stars | {stars} |
| Forks | {forks} |
| Watchers | {watchers} |
| Fork/Star Ratio | {ratio} (organic avg: 0.160) |
| Watcher/Star Ratio | {ratio} (healthy: 0.005-0.030) |

### Stargazer Profile Analysis (sample: {n})
| Metric | Value | Organic Baseline |
|--------|-------|-----------------|
| Zero public repos | {x}% | 2-6% |
| Zero followers | {x}% | 5-12% |
| Ghost accounts | {x}% | ~1% |

### Trust Signals
{List each signal with severity indicator}

### Disclaimer
This analysis uses heuristics based on CMU's StarScout research (ICSE 2026).
It identifies statistical patterns, not definitive proof of manipulation.
Some legitimate repos may have unusual patterns due to viral events, marketing campaigns, or community structure.
```

IMPORTANT: Always include the disclaimer. This is a heuristic analysis, not definitive proof. Be factual and objective in the report.
