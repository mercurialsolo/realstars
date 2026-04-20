---
name: check-stars
description: Analyze a GitHub repository for fake stars using 13 weighted detection signals. Use when the user asks to check, verify, or fact-check GitHub stars for any repo. Accepts owner/repo or full GitHub URLs.
user_invocable: true
arguments:
  - name: repo
    description: "GitHub repository in owner/repo format or a GitHub URL"
    required: true
---

# RealStars - GitHub Star Fact Checker (13-Signal Analysis)

You are analyzing a GitHub repository for signs of fake/purchased stars using 13 weighted detection signals based on the CMU StarScout (ICSE 2026) research methodology and extended heuristics.

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
# Get repo metadata (stars, forks, watchers, age, issues, etc.)
gh api repos/{owner}/{repo} --jq '{
  stars: .stargazers_count,
  forks: .forks_count,
  watchers: .subscribers_count,
  open_issues: .open_issues_count,
  created_at: .created_at,
  updated_at: .updated_at,
  pushed_at: .pushed_at,
  description: .description,
  archived: .archived,
  topics: .topics,
  language: .language,
  has_issues: .has_issues,
  homepage: .homepage
}'
```

```bash
# Get contributor count (first page, check if there are more)
gh api "repos/{owner}/{repo}/contributors?per_page=1&anon=true" --include 2>&1 | grep -i "^link:"
```

```bash
# Get recent releases to cross-reference with star spikes
gh api "repos/{owner}/{repo}/releases?per_page=10" --jq '.[].published_at'
```

```bash
# Get open and closed issue counts for community health
gh api "repos/{owner}/{repo}/issues?state=all&per_page=1" --include 2>&1 | grep -i "^link:"
```

```bash
# Get pull request activity
gh api "repos/{owner}/{repo}/pulls?state=all&per_page=1" --include 2>&1 | grep -i "^link:"
```

## Step 3: Signal 1 — Fork/Star & Watcher/Star Ratios (Weight: 0.12)

Calculate these key ratios:

1. **Fork-to-Star Ratio** = forks / stars
   - Organic average: ~0.160
   - Suspicious: < 0.05
   - Highly suspicious: < 0.02

2. **Watcher-to-Star Ratio** = watchers (subscribers) / stars
   - Healthy range: 0.005 - 0.030
   - Suspicious: < 0.005
   - Highly suspicious: < 0.001

Sub-score mapping:
- Both ratios healthy: 1.0
- One ratio suspicious: 0.6
- One ratio highly suspicious: 0.3
- Both highly suspicious: 0.1

## Step 4: Signal 2 — Community Engagement (Weight: 0.08)

Calculate community health metrics:

- **Issue/Star ratio** = total issues / stars (organic: > 0.01, suspicious: < 0.002)
- **Contributor/Star ratio** = contributors / stars (organic: > 0.005, suspicious: < 0.001)
- **PR activity** = total PRs relative to repo age and stars

Sub-score mapping:
- Active community with proportional issues/PRs/contributors: 1.0
- Low but present activity: 0.6
- Near-zero activity with high stars: 0.2

## Step 5: Signal 3 — Star Timing Analysis (Weight: 0.15)

Fetch star timestamps across multiple pages:

```bash
# Get early stars
gh api -H "Accept: application/vnd.github.v3.star+json" \
  "repos/{owner}/{repo}/stargazers?per_page=100&page=1" \
  --jq '.[].starred_at'

# Get middle stars (calculate page = total_stars / 100 / 2)
gh api -H "Accept: application/vnd.github.v3.star+json" \
  "repos/{owner}/{repo}/stargazers?per_page=100&page={middle_page}" \
  --jq '.[].starred_at'

# Get recent stars
gh api -H "Accept: application/vnd.github.v3.star+json" \
  "repos/{owner}/{repo}/stargazers?per_page=100&page={last_page}" \
  --jq '.[].starred_at'
```

Analyze:
- **Burst detection**: Calculate rolling daily/weekly rates. Flag periods where rate exceeds 10x the baseline.
- **Uniform spacing**: Calculate time deltas between consecutive stars. If coefficient of variation < 0.1, flag as bot-like.
- **Odd-hours starring**: Check if > 40% of stars in a burst period arrive during 00:00-06:00 UTC.

Sub-score mapping:
- No bursts, organic variation: 1.0
- Minor burst correlating with release/event: 0.8
- Burst without explanation: 0.4
- Multiple unexplained bursts + uniform spacing: 0.1

## Step 6: Signal 4 — Stargazer Profile Quality (Weight: 0.15)

Sample stargazer profiles from beginning, middle, and end of the list:

```bash
# Get stargazers from beginning
gh api "repos/{owner}/{repo}/stargazers?per_page=30&page=1" --jq '.[].login'

# Get stargazers from middle
gh api "repos/{owner}/{repo}/stargazers?per_page=30&page={middle_page}" --jq '.[].login'

# Get stargazers from end (most recent)
gh api "repos/{owner}/{repo}/stargazers?per_page=30&page={last_page}" --jq '.[].login'
```

For each sampled user (aim for 60-100 profiles):

```bash
gh api "users/{username}" --jq '{
  login: .login,
  public_repos: .public_repos,
  followers: .followers,
  following: .following,
  bio: .bio,
  created_at: .created_at,
  avatar_url: .avatar_url,
  location: .location,
  company: .company
}'
```

Measure:
- **% with zero public repos** (organic: 2-6%, suspicious: > 32%)
- **% with zero followers** (organic: 5-12%, suspicious: > 52%)
- **% ghost accounts** (zero repos + zero followers + no bio) (organic: ~1%, suspicious: > 19%)
- **% default avatar** (no custom profile picture) (organic: 3-8%, suspicious: > 50%)
- **% zero-activity** (zero repos + zero following + zero gists) (organic: 1-4%, suspicious: > 40%)

Sub-score mapping:
- All metrics within organic range: 1.0
- 1-2 metrics slightly elevated: 0.7
- Multiple metrics in suspicious range: 0.3
- Ghost accounts > 19%: 0.1

## Step 7: Signal 5 — Account Creation Clustering (Weight: 0.10)

Using the profile data already fetched (created_at field), bin account creation dates into 2-week windows.

Analysis:
- Count stargazers created in each 2-week window
- Flag if > 30% of sampled accounts fall in any single window
- Check for accounts created within 48 hours of each other

Sub-score mapping:
- No clustering (max window < 10%): 1.0
- Mild clustering (10-20% in one window): 0.7
- Moderate clustering (20-30%): 0.4
- Heavy clustering (> 30% in one window): 0.1

## Step 8: Signal 6 — Username Pattern Detection (Weight: 0.08)

Analyze the usernames of sampled stargazers:

- **Shannon entropy**: Calculate character-level entropy. Bot-generated random strings have entropy > 4.2 bits.
- **Regex patterns**: Check for patterns like `[a-z]+[0-9]{4,}`, `[a-z]{2,4}-[a-z]{2,4}-[a-z0-9]+`, repetitive structures.
- **Length clustering**: Check if an unusual percentage share the exact same username length.

Sub-score mapping:
- Normal username distribution (< 10% matching bot patterns): 1.0
- Some suspicious names (10-25%): 0.6
- Many bot-pattern names (> 25%): 0.3
- High entropy + pattern match (> 40%): 0.1

## Step 9: Signal 7 — Stargazer Overlap (Weight: 0.12)

For a subset of sampled stargazers (10-20 users), fetch their starred repos:

```bash
gh api "users/{username}/starred?per_page=100" --jq '.[].full_name'
```

Analysis:
- Compute Jaccard similarity between pairs of stargazer starred-repo sets
- Identify non-popular repos (< 500 stars) that appear in multiple sampled users' starred lists
- Flag if > 5 obscure repos are shared by > 30% of the sample

Sub-score mapping:
- Low overlap (average Jaccard < 0.05): 1.0
- Moderate overlap (0.05-0.15): 0.6
- High overlap (0.15-0.30): 0.3
- Extreme overlap (> 0.30 or > 5 shared obscure repos): 0.1

## Step 10: Signal 8 — Cross-Platform Correlation (Weight: 0.05)

Check if the repo has a corresponding package on npm, PyPI, or crates.io:

```bash
# For JavaScript/TypeScript projects, check npm
curl -s "https://api.npmjs.org/downloads/point/last-week/{package_name}" | jq '.downloads'

# For Python projects, check PyPI
curl -s "https://pypistats.org/api/packages/{package_name}/recent" | jq '.data.last_week'

# For Rust projects, check crates.io
curl -s "https://crates.io/api/v1/crates/{package_name}" | jq '.crate.recent_downloads'
```

Analysis:
- Calculate downloads-per-star-per-week ratio
- Healthy: > 1.0 for npm, > 0.5 for PyPI, > 0.3 for crates.io
- Suspicious: < 0.01 for npm, < 0.005 for PyPI/crates.io

Sub-score mapping:
- Healthy download/star ratio: 1.0
- Low but nonzero: 0.6
- Extremely low (50k stars, 12 downloads): 0.1
- Not a package (signal not applicable): exclude from scoring, redistribute weight

## Step 11: Signal 9 — Geographic Clustering (Weight: 0.05)

Using the location field from already-fetched profiles:

- Count profiles with location data
- Group by region/country
- Flag if > 60% of those with location data share the same region

Sub-score mapping:
- Diverse geography (top region < 40%): 1.0
- Moderate concentration (40-60%): 0.6
- Heavy concentration (> 60% one region): 0.3
- Insufficient location data (< 20% have location): exclude from scoring, redistribute weight

## Step 12: Signal 10 — Star Velocity vs Releases (Weight: 0.05)

Cross-reference star timing spikes with release dates:

```bash
gh api "repos/{owner}/{repo}/releases?per_page=30" --jq '.[] | {tag: .tag_name, date: .published_at}'
```

Analysis:
- For each detected star spike, check if a release was published within 7 days prior
- Check for blog posts, HN/Reddit mentions (via repo topics, description links)
- Spikes explained by releases are organic; unexplained spikes are suspicious

Sub-score mapping:
- All spikes explained by events: 1.0
- Most spikes explained: 0.7
- Multiple unexplained spikes: 0.3
- Consistent spikes with no releases ever: 0.1

## Step 13: Signal 11 — Weighted Composite Scoring

Combine all signal sub-scores using these weights:

| Signal | Weight |
|--------|--------|
| Star Timing | 0.15 |
| Profile Quality | 0.15 |
| Engagement Ratios (fork/star, watcher/star) | 0.12 |
| Stargazer Overlap | 0.12 |
| Account Clustering | 0.10 |
| Community Health | 0.08 |
| Username Patterns | 0.08 |
| Cross-Platform | 0.05 |
| Geographic | 0.05 |
| Star Velocity | 0.05 |
| Known Farms | 0.05 |

For signals that could not be computed (e.g., no package for cross-platform, insufficient location data), redistribute their weight proportionally among the remaining signals.

```
trust_score = sum(signal_score[i] * effective_weight[i]) * 100
```

## Step 14: Signal 12 — Known Farm Blocklist (Weight: 0.05)

If a `known-farms.json` file is available in the RealStars repo, check if any sampled stargazers appear on the list.

Sub-score mapping:
- Zero matches: 1.0
- 1-2 matches in sample: 0.5
- 3+ matches: 0.1

If the blocklist is not available, exclude this signal and redistribute weight.

## Step 15: Signal 13 — Historical Tracking

Note the current score and date for future comparison. If prior scores exist, compare:
- Score improving: farm accounts being cleaned up
- Score degrading: possible new purchasing campaign
- Score stable: consistent pattern

## Step 16: Present the report

Format the results as a clear report:

```
## RealStars Analysis: {owner}/{repo}

### Trust Score: {grade} ({score}/100) - {label}

### Signal Breakdown
| Signal | Sub-Score | Weight | Contribution | Assessment |
|--------|-----------|--------|--------------|------------|
| Star Timing | {0.0-1.0} | 0.15 | {weighted} | {brief note} |
| Profile Quality | {0.0-1.0} | 0.15 | {weighted} | {brief note} |
| Engagement Ratios | {0.0-1.0} | 0.12 | {weighted} | {brief note} |
| Stargazer Overlap | {0.0-1.0} | 0.12 | {weighted} | {brief note} |
| Account Clustering | {0.0-1.0} | 0.10 | {weighted} | {brief note} |
| Community Health | {0.0-1.0} | 0.08 | {weighted} | {brief note} |
| Username Patterns | {0.0-1.0} | 0.08 | {weighted} | {brief note} |
| Cross-Platform | {0.0-1.0} | 0.05 | {weighted} | {brief note} |
| Geographic | {0.0-1.0} | 0.05 | {weighted} | {brief note} |
| Star Velocity | {0.0-1.0} | 0.05 | {weighted} | {brief note} |
| Known Farms | {0.0-1.0} | 0.05 | {weighted} | {brief note} |

### Repository Metrics
| Metric | Value |
|--------|-------|
| Stars | {stars} |
| Forks | {forks} |
| Watchers | {watchers} |
| Fork/Star Ratio | {ratio} (organic avg: 0.160) |
| Watcher/Star Ratio | {ratio} (healthy: 0.005-0.030) |
| Issues (total) | {n} |
| Contributors | {n} |
| Age | {duration since created_at} |

### Stargazer Profile Analysis (sample: {n})
| Metric | Value | Organic Baseline | Status |
|--------|-------|-----------------|--------|
| Zero public repos | {x}% | 2-6% | {ok/warning/alert} |
| Zero followers | {x}% | 5-12% | {ok/warning/alert} |
| Ghost accounts | {x}% | ~1% | {ok/warning/alert} |
| Default avatars | {x}% | 3-8% | {ok/warning/alert} |
| Zero-activity | {x}% | 1-4% | {ok/warning/alert} |

### Star Timing
| Period | Daily Rate | vs Baseline | Correlates With |
|--------|-----------|-------------|-----------------|
| {date range} | {n}/day | {multiplier}x | {release/event/none} |

### Account Creation Clustering
- Largest 2-week window: {x}% of sample (threshold: 30%)
- Assessment: {ok/suspicious}

### Username Analysis
- Bot-pattern matches: {x}% (threshold: 25%)
- Average entropy: {n} bits (suspicious > 4.2)

### Stargazer Overlap
- Average Jaccard similarity: {n}
- Shared obscure repos: {n} repos shared by {x}% of sample

### Cross-Platform
- Package: {name} on {platform}
- Downloads/star/week: {ratio} ({assessment})

### Red Flags
{Bulleted list of the most concerning findings, if any}

### Positive Signals
{Bulleted list of healthy indicators}

### Historical Context
- Current score: {score} ({date})
- Trend: {first analysis / improving / stable / degrading}

### Disclaimer
This analysis uses heuristics based on CMU's StarScout research (ICSE 2026) and extended signals.
It identifies statistical patterns, not definitive proof of manipulation.
Some legitimate repos may have unusual patterns due to viral events, marketing campaigns, or community structure.
```

IMPORTANT: Always include the disclaimer. This is a heuristic analysis, not definitive proof. Be factual and objective in the report.

IMPORTANT: If rate-limited, prioritize signals by weight (Star Timing and Profile Quality first). Note which signals could not be computed and why.
