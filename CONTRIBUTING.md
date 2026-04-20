# Contributing to RealStars

Thanks for your interest in improving fake star detection for the GitHub ecosystem.

## How to Contribute

### Reporting Issues

- **False positives**: If a repo you know is legitimate scores poorly, open an issue with the repo name and why you believe the score is inaccurate. This helps calibrate thresholds.
- **False negatives**: If a repo with known fake stars scores well, report it so we can improve detection.
- **Bugs**: Standard bug reports with reproduction steps.

### New Detection Signals

The most impactful contributions are new heuristics for detecting star manipulation. When proposing a new signal:

1. **Describe the signal** — What does it measure and why is it indicative?
2. **Show evidence** — Test against known-manipulated repos AND known-organic repos
3. **Define thresholds** — What values are normal vs. suspicious?
4. **Cite sources** — Link to research papers, blog posts, or data supporting the signal

### Code Contributions

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/new-signal`
3. Make your changes
4. Test against a variety of repos (small, large, organic, suspicious)
5. Open a pull request with:
   - Clear description of what changed
   - Test results showing impact on trust scores
   - Any calibration data

### Areas of Interest

- **Temporal analysis** — Detecting star bursts vs. organic growth curves
- **Network analysis** — Finding clusters of accounts that star the same repos
- **Activity correlation** — Checking if stargazers also create issues, PRs, or discussions
- **Cross-platform signals** — npm downloads, PyPI installs vs. star counts
- **Browser extensions** — Firefox, Safari, Edge ports
- **Internationalization** — Translating the UI

## Code Style

- Chrome extension: Vanilla JS, no build step, Manifest V3
- Claude plugin: Markdown skills with bash commands via `gh` CLI
- Keep dependencies minimal — the extension has zero dependencies by design

## Ethics

- Never use this tool to harass or publicly shame specific developers
- Present findings as statistical signals, not accusations
- Include disclaimers about heuristic limitations
- Don't game the scoring system — if you find a bypass, report it as an issue

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
