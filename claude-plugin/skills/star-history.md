---
name: star-history
description: Deep timing analysis of a GitHub repository's star growth. Detects bursts, bot patterns, and cross-references spikes with releases. Compares profile quality between spike and organic periods.
user_invocable: true
arguments:
  - name: repo
    description: "GitHub repository in owner/repo format"
    required: true
---

# RealStars - Star Growth & Timing Analysis

Deep timing analysis of a repository's star growth pattern. This skill is the timing analysis powerhouse — it reconstructs the star timeline, detects bursts, cross-references with releases, and compares profile quality between spike and organic periods.

## Input

Repository: `{{ repo }}`

## Step 1: Parse input

Parse the repo input (owner/repo or GitHub URL). Extract owner and repo name.

## Step 2: Fetch repository metadata

```bash
gh api repos/{owner}/{repo} --jq '{
  stars: .stargazers_count,
  forks: .forks_count,
  created_at: .created_at,
  pushed_at: .pushed_at,
  language: .language
}'
```

## Step 3: Fetch star timestamps across many pages

Use the Star Creation Timestamps API to build a comprehensive timeline. Sample pages spread across the entire stargazer list to reconstruct growth patterns:

```bash
# Page 1 — earliest stars
gh api -H "Accept: application/vnd.github.v3.star+json" \
  "repos/{owner}/{repo}/stargazers?per_page=100&page=1" \
  --jq '.[] | {user: .user.login, starred_at: .starred_at}'

# Page at 10% mark
gh api -H "Accept: application/vnd.github.v3.star+json" \
  "repos/{owner}/{repo}/stargazers?per_page=100&page={page_10pct}" \
  --jq '.[] | {user: .user.login, starred_at: .starred_at}'

# Page at 25% mark
gh api -H "Accept: application/vnd.github.v3.star+json" \
  "repos/{owner}/{repo}/stargazers?per_page=100&page={page_25pct}" \
  --jq '.[] | {user: .user.login, starred_at: .starred_at}'

# Page at 50% mark
gh api -H "Accept: application/vnd.github.v3.star+json" \
  "repos/{owner}/{repo}/stargazers?per_page=100&page={page_50pct}" \
  --jq '.[] | {user: .user.login, starred_at: .starred_at}'

# Page at 75% mark
gh api -H "Accept: application/vnd.github.v3.star+json" \
  "repos/{owner}/{repo}/stargazers?per_page=100&page={page_75pct}" \
  --jq '.[] | {user: .user.login, starred_at: .starred_at}'

# Page at 90% mark
gh api -H "Accept: application/vnd.github.v3.star+json" \
  "repos/{owner}/{repo}/stargazers?per_page=100&page={page_90pct}" \
  --jq '.[] | {user: .user.login, starred_at: .starred_at}'

# Last page — most recent stars
gh api -H "Accept: application/vnd.github.v3.star+json" \
  "repos/{owner}/{repo}/stargazers?per_page=100&page={last_page}" \
  --jq '.[] | {user: .user.login, starred_at: .starred_at}'
```

Calculate page numbers:
- total_pages = ceil(total_stars / 100)
- page_10pct = max(1, floor(total_pages * 0.10))
- page_25pct = max(1, floor(total_pages * 0.25))
- page_50pct = max(1, floor(total_pages * 0.50))
- page_75pct = max(1, floor(total_pages * 0.75))
- page_90pct = max(1, floor(total_pages * 0.90))
- last_page = total_pages

For repos with fewer than 700 stars (< 7 pages), fetch all pages for complete data.

## Step 4: Build daily/weekly aggregation

From the sampled timestamps:
- Group stars by day and by week
- Calculate a rolling 7-day average as the "baseline" rate
- Calculate a rolling 30-day average for trend detection
- Identify the overall average daily rate: total_stars / repo_age_in_days

## Step 5: Detect bursts

A burst is defined as a period where the daily star rate exceeds 10x the rolling baseline.

For each detected burst:
- Record start date, end date, duration
- Count stars received during the burst
- Calculate the burst multiplier (burst rate / baseline rate)
- Note the percentage of total stars received during burst periods

Additional timing signals:
- **Uniform spacing**: Calculate the coefficient of variation (std_dev / mean) of time deltas between consecutive stars within burst periods. CV < 0.1 suggests bot automation.
- **Odd-hours concentration**: Calculate what percentage of stars in burst periods arrive between 00:00-06:00 UTC. Organic starring follows work-hour patterns; > 40% in odd hours is suspicious.
- **Day-of-week distribution**: Organic stars show weekday bias. Flat or weekend-heavy distribution during bursts is unusual.

## Step 6: Cross-reference burst periods with releases

```bash
gh api "repos/{owner}/{repo}/releases?per_page=100" --jq '.[] | {tag: .tag_name, date: .published_at, name: .name}'
```

For each detected burst:
- Check if a release was published within 7 days before the burst started
- Check if the repo was mentioned on Hacker News, Reddit, or ProductHunt (infer from description/homepage links, topics)
- Classify each burst as:
  - **Explained**: correlates with release, event, or external trigger
  - **Partially explained**: timing is close but magnitude seems disproportionate
  - **Unexplained**: no identifiable trigger

## Step 7: Profile quality comparison — spike vs organic periods

This is the key differentiator. Sample stargazer profiles from burst periods and from organic (non-burst) periods, then compare quality.

**During burst periods** — get usernames from the timestamp data for pages that fall within burst dates:

```bash
gh api "users/{username}" --jq '{
  login: .login,
  public_repos: .public_repos,
  followers: .followers,
  following: .following,
  bio: .bio,
  created_at: .created_at,
  avatar_url: .avatar_url,
  location: .location
}'
```

Sample 15-30 profiles from burst-period stargazers and 15-30 from organic-period stargazers.

Compare:
| Metric | Burst Period | Organic Period | Delta |
|--------|-------------|----------------|-------|
| Zero public repos | {x}% | {y}% | {diff} |
| Zero followers | {x}% | {y}% | {diff} |
| Ghost accounts | {x}% | {y}% | {diff} |
| Default avatars | {x}% | {y}% | {diff} |
| Avg account age | {x} months | {y} months | {diff} |
| Bot-pattern usernames | {x}% | {y}% | {diff} |

If burst-period profiles are significantly lower quality than organic-period profiles, this is a strong signal of purchased stars.

## Step 8: Account creation clustering during bursts

For burst-period stargazers, bin their account creation dates into 2-week windows:
- If > 30% were created in the same window, this indicates batch-created farm accounts
- Check if account creation dates cluster shortly before the starring event (freshly minted accounts)

## Step 9: Present the analysis

```
## Star Growth Analysis: {owner}/{repo}

### Overview
- Created: {date}
- Total stars: {n}
- Repo age: {days/months/years}
- Average daily growth: {n}/day
- Current velocity (last 30 days): {n}/day

### Growth Timeline
| Period | Stars Added | Daily Rate | vs Baseline | Assessment |
|--------|------------|------------|-------------|------------|
| {date range} | {n} | {rate}/day | {multiplier}x | Organic |
| {date range} | {n} | {rate}/day | {multiplier}x | BURST |
| {date range} | {n} | {rate}/day | {multiplier}x | Organic |
| ... | ... | ... | ... | ... |

### Burst Detection Summary
- Total bursts detected: {n}
- Stars received during bursts: {n} ({x}% of total)
- Bursts explained by releases/events: {n}/{total}
- Unexplained bursts: {n}

### Burst Details
{For each detected burst:}

#### Burst {n}: {start_date} to {end_date}
- Duration: {days}
- Stars added: {n}
- Rate: {n}/day ({multiplier}x baseline)
- Uniform spacing (CV): {value} {(bot-like / natural)}
- Odd-hours %: {x}% {(normal / elevated)}
- Correlating event: {release vX.Y / HN post / none found}
- Assessment: {Explained / Suspicious / Highly Suspicious}

### Timing Signal Analysis
| Signal | Value | Threshold | Status |
|--------|-------|-----------|--------|
| Max burst multiplier | {x}x | > 10x suspicious | {ok/warning/alert} |
| Uniform spacing (lowest CV) | {x} | < 0.1 bot-like | {ok/warning/alert} |
| Odd-hours % (burst periods) | {x}% | > 40% suspicious | {ok/warning/alert} |
| % stars in burst periods | {x}% | > 50% suspicious | {ok/warning/alert} |
| Unexplained burst count | {n} | > 0 warrants review | {ok/warning/alert} |

### Profile Quality: Burst vs Organic Periods
| Metric | Burst Period ({n} sampled) | Organic Period ({n} sampled) | Organic Baseline |
|--------|---------------------------|------------------------------|-----------------|
| Zero public repos | {x}% | {y}% | 2-6% |
| Zero followers | {x}% | {y}% | 5-12% |
| Ghost accounts | {x}% | {y}% | ~1% |
| Default avatars | {x}% | {y}% | 3-8% |
| Bot-pattern usernames | {x}% | {y}% | < 5% |
| Avg account age | {x} months | {y} months | — |

### Account Creation Clustering (Burst-Period Stargazers)
- Largest 2-week window: {x}% of burst stargazers
- Assessment: {No clustering / Mild clustering / Heavy clustering}

### Release Timeline Cross-Reference
| Release | Date | Stars in Following 7 Days | Assessment |
|---------|------|--------------------------|------------|
| {tag} | {date} | {n} | Expected post-release bump |
| — | {burst date} | {n} | No release — unexplained |

### Overall Timing Assessment
- Growth pattern: {Organic / Mixed / Suspicious / Highly Suspicious}
- Confidence: {High / Medium / Low} (based on data completeness)
- Key concern: {main finding or "None — growth appears organic"}

### ASCII Growth Visualization
{Simple ASCII sparkline or bar chart showing relative monthly star counts,
with burst periods marked:}

Stars/month:
2023-01: ████████ (120)
2023-02: █████████ (135)
2023-03: ██████████████████████████████████████████ (580) *** BURST
2023-04: ████████ (110)
2023-05: █████████ (140)
...

### Disclaimer
Growth spikes can be caused by legitimate events (Hacker News/Reddit posts, conference talks,
product launches, trending on GitHub Explore). Cross-reference with public events before
drawing conclusions. This analysis identifies patterns, not proof of manipulation.
```

IMPORTANT: Always cross-reference bursts with releases before calling them suspicious. A legitimate project featured on Hacker News can easily get 10-50x its normal daily stars.

IMPORTANT: If the repo has fewer than 100 stars, star timing analysis has limited statistical power. Note this in the confidence assessment.

IMPORTANT: If rate-limited during profile sampling, note the reduced sample size and lower confidence accordingly.
