---
name: star-history
description: Analyze the star growth pattern of a GitHub repository over time to detect suspicious spikes that may indicate star purchasing campaigns.
user_invocable: true
arguments:
  - name: repo
    description: "GitHub repository in owner/repo format"
    required: true
---

# RealStars - Star Growth Pattern Analysis

Analyze how a repository's stars grew over time to detect unnatural spikes that may indicate purchasing campaigns.

## Input

Repository: `{{ repo }}`

## Process

1. Parse the repo input (owner/repo or GitHub URL).

2. Fetch starred-at timestamps using the Star Creation Timestamps API:

```bash
# GitHub returns starred_at when using the star-timestamps media type
gh api -H "Accept: application/vnd.github.v3.star+json" \
  "repos/{owner}/{repo}/stargazers?per_page=100&page=1" \
  --jq '.[].starred_at'
```

Sample multiple pages spread across the stargazer list to build a timeline.

3. Analyze the growth pattern:
   - Calculate daily/weekly star rates across different time periods
   - Identify sudden spikes (>10x normal rate)
   - Check if spikes correlate with known events (releases, HN posts, etc.)
   - Look for "staircase" patterns (flat periods followed by sudden jumps)

4. Cross-reference spike periods:
   During spike periods, sample the stargazer profiles to check if the accounts
   that starred during spikes are lower quality than those during organic periods.

5. Present the analysis:

```
## Star Growth Analysis: {owner}/{repo}

### Timeline
- Created: {date}
- Total stars: {n}
- Average daily growth: {n}/day

### Growth Periods
| Period | Stars Added | Daily Rate | Profile Quality | Assessment |
|--------|------------|------------|-----------------|------------|
| {date range} | {n} | {rate}/day | {quality score} | Organic / Suspicious |

### Spike Detection
{List any detected spikes with dates and analysis}

### Disclaimer
Growth spikes can be caused by legitimate events (HN/Reddit posts, conference talks,
product launches). Cross-reference with public events before drawing conclusions.
```
