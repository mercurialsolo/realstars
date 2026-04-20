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
Returns a full trust report with grade, metrics, stargazer profile analysis, and all signals.

**Compare multiple repos:**
```
/compare-stars tensorflow/tensorflow,pytorch/pytorch,jax-ml/jax
```
Side-by-side comparison table showing which repos have healthier star profiles.

**Analyze star growth over time:**
```
/star-history some-org/suspicious-repo
```
Detects unnatural growth spikes that may indicate purchasing campaigns.

---

## Detection Signals

| Signal | Organic Baseline | Suspicious Threshold | Source |
|--------|-----------------|---------------------|--------|
| Fork/Star ratio | ~0.160 | < 0.05 | CMU StarScout |
| Watcher/Star ratio | 0.005-0.030 | < 0.001 | CMU StarScout |
| Stargazers with 0 repos | 2-6% | > 32% | Profile sampling |
| Stargazers with 0 followers | 5-12% | > 52% | Profile sampling |
| Zero-activity accounts | Low | > 40% | Profile sampling |
| Default avatar (no picture) | Low | > 50% | Profile sampling |
| Ghost accounts (fully empty) | ~1% | > 19% | Profile sampling |

### How the Trust Score Works

Start at 100 and deduct points for each red flag:

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
| Zero-activity accounts | > 40% | -15 |
| Zero-activity accounts | > 15% | -7 |
| Default avatars | > 50% | -15 |
| Default avatars | > 25% | -7 |
| Ghost accounts | > 15% | -20 |
| Ghost accounts | > 5% | -8 |

---

## Project Structure

```
realstars/
├── README.md
├── LICENSE                   (MIT)
├── CONTRIBUTING.md
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
- Scores should be one input among many when evaluating a repository

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Key areas:

- **New detection signals** — temporal clustering, network analysis, cross-platform correlation
- **Better thresholds** — calibration from larger datasets
- **Browser support** — Firefox, Safari, Edge ports
- **Visualization** — star growth charts, network graphs

## Research References

- Wentao He et al., "StarScout: A Large-Scale Dataset for GitHub Star Studies" (ICSE 2026) — [arXiv:2412.13459](https://arxiv.org/abs/2412.13459)
- Awesome Agents AI, ["GitHub Fake Stars Investigation"](https://awesomeagents.ai/news/github-fake-stars-investigation/)

## License

MIT — See [LICENSE](LICENSE)
