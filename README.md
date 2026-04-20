# RealStars - GitHub Star Fact Checker

**Detect fake GitHub stars using research-backed heuristics.**

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

## Detection Signals

| Signal | Organic Baseline | Suspicious Threshold | Source |
|--------|-----------------|---------------------|--------|
| Fork/Star ratio | ~0.160 | < 0.05 | CMU StarScout |
| Watcher/Star ratio | 0.005-0.030 | < 0.001 | CMU StarScout |
| Stargazers with 0 repos | 2-6% | > 32% | Profile sampling |
| Stargazers with 0 followers | 5-12% | > 52% | Profile sampling |
| Ghost accounts (empty profile) | ~1% | > 19% | Profile sampling |

## Components

### 1. Chrome Extension

A browser extension that injects a trust badge directly onto GitHub repository pages.

**Features:**
- Automatic analysis when you visit any GitHub repo
- Trust grade badge (A-F) next to the star button
- Detailed side panel with all signals on click
- Manual repo lookup via popup
- Optional GitHub token for higher API limits

**Install:**
1. Clone this repo
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" → select `chrome-extension/` folder
5. (Optional) Add a GitHub token in the popup for 5,000 requests/hour

### 2. Claude Code Plugin

A fact-checker plugin for [Claude Code](https://claude.ai/claude-code) that analyzes repos via the `gh` CLI.

**Skills:**
- `/check-stars owner/repo` — Full analysis of a single repo
- `/compare-stars repo1,repo2,repo3` — Side-by-side comparison
- `/star-history owner/repo` — Growth pattern analysis over time

**Install:**
```bash
# From the project root
claude plugin add ./claude-plugin
```

Or add to your Claude Code settings:
```json
{
  "plugins": ["./path/to/realstars/claude-plugin"]
}
```

## Trust Score

The trust score (0-100) is computed by starting at 100 and deducting points for each suspicious signal:

| Signal | Condition | Deduction |
|--------|-----------|-----------|
| Fork/Star ratio | < 0.02 | -30 |
| Fork/Star ratio | < 0.05 | -20 |
| Watcher/Star ratio | < 0.001 | -20 |
| Watcher/Star ratio | < 0.005 | -10 |
| Zero-repo stargazers | > 50% | -25 |
| Zero-repo stargazers | > 20% | -12 |
| Zero-follower stargazers | > 40% | -20 |
| Zero-follower stargazers | > 15% | -10 |
| Ghost accounts | > 15% | -20 |
| Ghost accounts | > 5% | -8 |

**Grades:**
- **A (80-100)**: Likely Organic
- **B (60-79)**: Mostly Organic
- **C (40-59)**: Some Suspicious Signals
- **D (20-39)**: Likely Manipulated
- **F (0-19)**: Highly Suspicious

## Limitations & Disclaimer

- This is a **heuristic analysis**, not definitive proof of manipulation
- Legitimate repos can score poorly due to viral events, marketing campaigns, or community structure
- Small repos (< 50 stars) only get ratio analysis, not profile sampling
- GitHub API rate limits constrain how many profiles can be sampled
- Scores should be one input among many when evaluating a repository

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Key areas where contributions are welcome:
- **New detection signals** — temporal clustering, network analysis, etc.
- **Improved thresholds** — better calibration from larger datasets
- **Browser support** — Firefox, Safari extensions
- **Visualization** — star growth charts, network graphs
- **API/service** — hosted analysis endpoint

## Research References

- Wentao He et al., "StarScout: A Large-Scale Dataset for GitHub Star Studies" (ICSE 2026) — [arXiv:2412.13459](https://arxiv.org/abs/2412.13459)
- Awesome Agents AI, ["GitHub Fake Stars Investigation"](https://awesomeagents.ai/news/github-fake-stars-investigation/)

## License

MIT — See [LICENSE](LICENSE)
