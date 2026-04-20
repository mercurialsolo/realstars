# RealStars - GitHub Star Fact Checker

**Detect fake GitHub stars using research-backed heuristics and 13 weighted detection signals.**

Based on [CMU's StarScout](https://arxiv.org/abs/2412.13459) (ICSE 2026) research that identified **6 million fake stars** across 18,617 repositories using 301,000 accounts.

## Why This Exists

GitHub stars are widely used as a credibility signal — by developers choosing dependencies, investors evaluating companies, and ranking indexes like ROSS. But the CMU study found:

- **16.66%** of repos with 50+ stars had fake star campaigns by mid-2024
- Star farms charge **$0.03-$0.90 per star** depending on account quality
- **90.42%** of flagged repos were subsequently deleted by GitHub
- AI/LLM repositories had **177,000 fake stars** — the largest non-malicious category

RealStars makes these detection signals accessible to everyone, as an open metric that bad actors can't game by hiding the methodology.

## Why Open Source?

Closed detection tools create an arms race where star farms can reverse-engineer what gets flagged. By making the methodology transparent:

1. **Everyone can verify** — No trust-us black box. See exactly what signals are checked.
2. **Community improves detection** — Researchers and developers can contribute new signals.
3. **Arms race transparency** — If star farms adapt, the community adapts faster.
4. **Prevents weaponization** — Open scoring means repos can't be unfairly targeted without evidence.

---

## Chrome Extension

### Install

1. Clone this repo:
   ```bash
   git clone https://github.com/mercurialsolo/realstars.git
   ```
2. Open Chrome and go to `chrome://extensions/`
3. Toggle **Developer mode** ON (top right)
4. Click **Load unpacked**
5. Select the `chrome-extension/` folder from the cloned repo
6. The RealStars icon appears in your toolbar

### Usage

**Automatic mode** — Just browse GitHub. When you visit any repository with 10+ stars, a trust badge appears inline next to the Star button:

```
[ Watch 4 ] [ Fork 52 ] [ Star 530 ] [ RealStars: A (92/100) ]
```

Click the badge to open a detailed side panel with all signals and metrics.

**Manual check** — Click the RealStars icon in your toolbar, enter any `owner/repo` or paste a GitHub URL, and hit Check.

**What the grades mean:**

| Grade | Score | Meaning |
|-------|-------|---------|
| **A** | 80-100 | Likely Organic — stars look real |
| **B** | 60-79 | Mostly Organic — minor anomalies |
| **C** | 40-59 | Some Suspicious Signals — investigate further |
| **D** | 20-39 | Likely Manipulated — strong fake indicators |
| **F** | 0-19 | Highly Suspicious — multiple red flags |

Repos with fewer than 10 stars are skipped (not enough data for meaningful analysis).

### GitHub Token (Optional)

RealStars works out of the box with no setup. It uses GitHub's public API which allows **60 requests/hour** unauthenticated — enough for casual browsing.

For heavier use (checking many repos, deeper profile sampling), add a token to get **5,000 requests/hour**:

1. Click the RealStars icon in your toolbar
2. Click **"Create token on GitHub (1 click)"** — this opens GitHub's token page with the correct permissions pre-selected (`public_repo`, read-only)
3. On GitHub, click **Generate token** and copy it
4. Paste the token back in RealStars and click **Save**
5. RealStars validates the token and shows your username + remaining rate limit

**Token management:**
- **Refresh** — Check current rate limit and validate token is still active
- **Delete** — Remove the token and go back to unauthenticated mode

The token is stored locally in Chrome's sync storage. It never leaves your browser except to authenticate with GitHub's API.

---

## Claude Code Plugin

A fact-checker plugin for [Claude Code](https://claude.ai/claude-code) that analyzes repos via the `gh` CLI.

### Install

```bash
claude plugin add ./claude-plugin
```

Or add to your Claude Code settings:
```json
{
  "plugins": ["./path/to/realstars/claude-plugin"]
}
```

### Usage

**Check a single repo:**
```
/check-stars facebook/react
```
Returns a full trust report with grade, weighted composite score, per-category breakdowns, and all 13 signal analyses.

**Compare multiple repos:**
```
/compare-stars tensorflow/tensorflow,pytorch/pytorch,jax-ml/jax
```
Side-by-side comparison table showing all signal scores per repo.

**Analyze star growth over time:**
```
/star-history some-org/suspicious-repo
```
Timing analysis powerhouse: burst detection, release cross-referencing, and profile quality comparison between spike and organic periods.

---

## Detection Signals

RealStars uses 13 weighted detection signals, scored via a Bayesian composite model.

| # | Signal | What It Detects | Source |
|---|--------|----------------|--------|
| 1 | Fork/Star & Watcher/Star Ratios | Low engagement relative to stars | CMU StarScout |
| 2 | Community Engagement | Issue/star ratio, contributor/star ratio, PR activity | GitHub API |
| 3 | Star Timing Analysis | Bursts (>10x baseline), uniform spacing, odd-hours starring | Star timestamps API |
| 4 | Stargazer Profile Quality | Zero repos %, zero followers %, ghost accounts %, default avatar %, zero-activity % | Profile sampling |
| 5 | Account Creation Clustering | >30% of stargazers created in the same 2-week window | Profile sampling |
| 6 | Username Pattern Detection | Shannon entropy analysis, regex patterns for bot-generated names | Profile sampling |
| 7 | Stargazer Overlap | Farm fingerprinting via Jaccard similarity on starred repos | Starred repos API |
| 8 | Cross-Platform Correlation | npm/PyPI/crates.io downloads vs star count mismatches | Package registry APIs |
| 9 | Geographic Clustering | >60% of stargazers with location in same region | Profile sampling |
| 10 | Star Velocity vs Releases | Star spikes without corresponding releases or external triggers | Releases API |
| 11 | Weighted Composite Scoring | Bayesian model combining all signals by reliability | Internal |
| 12 | Known Farm Blocklist | Community-maintained list of confirmed star-farm accounts | known-farms.json |
| 13 | Historical Tracking | Score trends over time | Local storage |

---

## Signal Deep Dive

### 1. Fork/Star & Watcher/Star Ratios

Real users who find a project useful tend to fork it (to contribute or customize) and watch it (to track updates). Fake star accounts almost never do either.

| Metric | Organic Baseline | Suspicious | Highly Suspicious |
|--------|-----------------|------------|-------------------|
| Fork/Star ratio | ~0.160 | < 0.05 | < 0.02 |
| Watcher/Star ratio | 0.005-0.030 | < 0.005 | < 0.001 |

### 2. Community Engagement

Active communities produce issues, pull requests, and contributors proportional to their star count. Repos with inflated stars but no actual usage show disproportionately low activity.

| Metric | Organic Signal | Red Flag |
|--------|---------------|----------|
| Issue/Star ratio | > 0.01 | < 0.002 |
| Contributor/Star ratio | > 0.005 | < 0.001 |
| Open PRs | Proportional to size | Near zero with high stars |

### 3. Star Timing Analysis

Organic growth is irregular and correlates with external events. Purchased stars arrive in bursts with suspicious regularity.

| Pattern | Description | Threshold |
|---------|-------------|-----------|
| Burst detection | Sudden spike vs rolling baseline | >10x normal daily rate |
| Uniform spacing | Equal intervals between stars (bot signal) | Coefficient of variation < 0.1 |
| Odd-hours starring | Stars concentrated in unusual UTC hours | >40% in 00:00-06:00 UTC |

### 4. Stargazer Profile Quality (Enhanced)

Sample stargazer profiles and measure the percentage of low-quality accounts.

| Metric | Organic Baseline | Suspicious Threshold |
|--------|-----------------|---------------------|
| Zero public repos | 2-6% | > 32% |
| Zero followers | 5-12% | > 52% |
| Ghost accounts (zero repos + followers + no bio) | ~1% | > 19% |
| Default avatar (no profile picture) | 3-8% | > 50% |
| Zero-activity accounts | 1-4% | > 40% |

### 5. Account Creation Clustering

Star farm operators often create batches of accounts around the same time. Binning stargazer creation dates into 2-week windows reveals clusters.

| Metric | Organic Pattern | Suspicious |
|--------|----------------|------------|
| Max accounts in any 2-week window | < 10% of sample | > 30% of sample |
| Accounts created within 48h of each other | Rare | > 20% of sample |

### 6. Username Pattern Detection

Bot-generated usernames exhibit detectable statistical properties that differ from human-chosen names.

| Signal | Method | Threshold |
|--------|--------|-----------|
| Shannon entropy | Information entropy of character distribution | > 4.2 bits (random strings) |
| Regex patterns | `[a-z]+[0-9]{4,}`, `[a-z]{2,4}-[a-z]{2,4}-[a-z0-9]+` | > 25% matching known bot patterns |
| Name length clustering | Unusual concentration at specific lengths | > 40% at same length |

### 7. Stargazer Overlap

Star farms reuse the same accounts across multiple campaigns. Checking what else a sample of stargazers have starred reveals shared "fingerprints."

| Metric | Method | Suspicious |
|--------|--------|------------|
| Jaccard similarity | Pairwise similarity of starred repo sets | > 0.3 among random pairs |
| Shared obscure repos | Non-popular repos starred by multiple sampled users | > 5 repos shared by > 30% of sample |

### 8. Cross-Platform Correlation

A library with 50,000 stars but 12 weekly downloads on npm/PyPI is extremely suspicious. Real popularity generates real usage.

| Platform | Healthy Ratio (downloads/star/week) | Suspicious |
|----------|-------------------------------------|------------|
| npm | > 1.0 | < 0.01 |
| PyPI | > 0.5 | < 0.005 |
| crates.io | > 0.3 | < 0.005 |

Note: Not all repos are packages. This signal is only applied when a corresponding package is found.

### 9. Geographic Clustering

Organic projects attract global audiences. Star farms often operate from a single region.

| Metric | Organic Pattern | Suspicious |
|--------|----------------|------------|
| Top region concentration | < 40% from any single region | > 60% from one region |
| Region diversity (among those with location) | 5+ countries represented | < 3 countries |

Note: Many GitHub profiles lack location data. This signal is weighted lower and only applied when sufficient location data exists.

### 10. Star Velocity vs Releases

Organic star growth correlates with releases, blog posts, conference talks, or social media mentions. Purchased stars spike without any corresponding event.

| Pattern | Organic | Suspicious |
|---------|---------|------------|
| Spike with release within 7 days | Expected | N/A |
| Spike with no release, no external trigger | Rare | Flag for review |
| Multiple unexplained spikes | Very rare | Strong signal |

### 11. Weighted Composite Scoring

Rather than flat deductions, RealStars uses a Bayesian model where each signal contributes based on its reliability and the strength of the finding.

Each signal produces a sub-score from 0.0 (maximally suspicious) to 1.0 (fully organic). The final trust score is the weighted combination of all available signal scores.

### 12. Known Farm Blocklist

A community-maintained list (`known-farms.json`) of confirmed star-farm accounts identified through prior research and community reports. If sampled stargazers appear on this list, it directly reduces the trust score.

### 13. Historical Tracking

RealStars stores scores over time (locally in the extension, or via the plugin). Tracking whether a repo's score is improving or degrading provides valuable context — a sudden drop may indicate a new purchasing campaign.

---

## Trust Score Weights

The composite trust score combines all signal sub-scores using these weights:

| Module | Weight | Rationale |
|--------|--------|-----------|
| Star Timing | 0.15 | Strongest individual signal; hard to fake organic timing |
| Profile Quality | 0.15 | Directly measures account authenticity |
| Engagement Ratios | 0.12 | Fork/star and watcher/star are well-calibrated |
| Stargazer Overlap | 0.12 | Farm fingerprint is highly specific |
| Account Clustering | 0.10 | Batch creation is a strong farm indicator |
| Community Health | 0.08 | Issues/PRs/contributors validate real usage |
| Username Patterns | 0.08 | Entropy analysis catches bulk-generated names |
| Cross-Platform | 0.05 | Only applicable to packages; powerful when available |
| Geographic | 0.05 | Limited by location data availability |
| Star Velocity | 0.05 | Context-dependent; releases explain legitimate spikes |
| Known Farms | 0.05 | Binary signal; low weight due to list coverage |

Weights sum to 1.0. When a signal cannot be computed (e.g., no package found for cross-platform, insufficient location data), its weight is redistributed proportionally among the remaining signals.

---

## How the Trust Score Works

RealStars uses a **weighted composite scoring model** (Bayesian-inspired) instead of flat point deductions.

### Scoring Process

1. **Each signal module produces a sub-score** from 0.0 to 1.0:
   - 1.0 = fully organic pattern
   - 0.5 = inconclusive / neutral
   - 0.0 = maximally suspicious

2. **Sub-scores are combined** using the weight table above:
   ```
   trust_score = sum(signal_score[i] * weight[i]) for all available signals
   ```

3. **Unavailable signals are excluded** and their weight redistributed:
   ```
   effective_weight[i] = weight[i] / sum(available_weights)
   ```

4. **Final score is scaled to 0-100** and graded:
   - **A (80-100)**: Likely Organic
   - **B (60-79)**: Mostly Organic
   - **C (40-59)**: Some Suspicious Signals
   - **D (20-39)**: Likely Manipulated
   - **F (0-19)**: Highly Suspicious

### Why Weighted Composite?

The old approach (start at 100, deduct points) had problems:
- Signals could "double-dip" on the same underlying issue
- No way to express confidence levels
- Missing data penalized repos unfairly

The weighted model handles partial data gracefully, weights signals by their proven reliability, and produces more calibrated scores across diverse repo types.

---

## Analysis Depth

RealStars operates at three depth levels depending on available resources:

### Quick (No Token Required)

Available with unauthenticated GitHub API (60 requests/hour). Suitable for casual browsing.

**Signals used:**
- Fork/Star & Watcher/Star ratios
- Small profile sample (10 users)
- Username pattern detection
- Account creation clustering (from sampled profiles)
- Cross-platform correlation (npm/PyPI/crates.io lookup)

**Typical accuracy:** Good for catching obvious fakes; may miss sophisticated campaigns.

### Standard (With Token)

Available with authenticated GitHub API (5,000 requests/hour). The default for the Chrome extension with a token configured.

**Signals used (all of the above plus):**
- Star timing analysis (timestamp API)
- Larger profile sample (30-60 users)
- Stargazer overlap analysis
- Community health metrics (issues, PRs, contributors)
- Geographic clustering
- Star velocity vs releases
- Known farm blocklist matching

**Typical accuracy:** Catches most fake star campaigns including moderately sophisticated ones.

### Deep (Manual, via Claude Plugin)

Available through the `/check-stars` Claude Code plugin with full `gh` CLI access. Designed for thorough investigation.

**Signals used (all of the above plus):**
- Large profile sample (100+ users across early, middle, and recent stargazers)
- Full star timeline reconstruction (multiple pages of timestamps)
- Deep overlap analysis (checking starred repos of many sampled users)
- Cross-referencing burst periods with release history
- Profile quality comparison between spike-period and organic-period stargazers
- Historical score tracking and trend analysis

**Typical accuracy:** Research-grade analysis suitable for due diligence and investigation reports.

---

## Project Structure

```
realstars/
├── README.md
├── LICENSE                   (MIT)
├── CONTRIBUTING.md
├── known-farms.json          Community-maintained star-farm account list
├── chrome-extension/
│   ├── manifest.json         Manifest V3
│   ├── background.js         API calls, caching, scoring engine
│   ├── content.js            Badge injection on GitHub pages
│   ├── content.css           Badge + side panel styles
│   ├── popup.html            Extension popup UI
│   ├── popup.js              Token management, manual checks
│   └── icons/
└── claude-plugin/
    ├── plugin.json
    └── skills/
        ├── check-stars.md    /check-stars
        ├── compare-repos.md  /compare-stars
        └── star-history.md   /star-history
```

## Limitations & Disclaimer

- This is a **heuristic analysis**, not definitive proof of manipulation
- Legitimate repos can score poorly due to viral events, marketing campaigns, or community structure
- Small repos (< 10 stars) are skipped; repos with 10-49 stars get ratio-only analysis
- GitHub API rate limits constrain how many profiles can be sampled
- Cross-platform signal only applies when a matching package exists on npm/PyPI/crates.io
- Geographic signal is limited by the percentage of profiles with location data
- Scores should be one input among many when evaluating a repository

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Key areas:

- **Threshold calibration** — larger datasets for better signal boundaries
- **Known farms list** — contribute confirmed star-farm accounts to `known-farms.json`
- **New signals** — network graph analysis, commit activity correlation
- **Better weights** — Bayesian prior tuning from labeled datasets
- **Browser support** — Firefox, Safari, Edge ports
- **Visualization** — star growth charts, network graphs, historical trends

## Research References

- Wentao He et al., "StarScout: A Large-Scale Dataset for GitHub Star Studies" (ICSE 2026) — [arXiv:2412.13459](https://arxiv.org/abs/2412.13459)
- Awesome Agents AI, ["GitHub Fake Stars Investigation"](https://awesomeagents.ai/news/github-fake-stars-investigation/)

## License

MIT — See [LICENSE](LICENSE)
