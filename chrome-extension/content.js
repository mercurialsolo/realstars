// RealStars - Content Script
// Injects trust badge into GitHub repository pages

(function () {
  "use strict";

  let currentRepo = null;
  let panelOpen = false;

  function getRepoFromUrl() {
    const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/?/);
    if (!match) return null;
    const owner = match[1];
    const repo = match[2];
    // Exclude GitHub UI paths
    const excluded = [
      "settings",
      "marketplace",
      "explore",
      "topics",
      "trending",
      "collections",
      "events",
      "sponsors",
      "notifications",
      "new",
      "organizations",
      "login",
      "signup",
    ];
    if (excluded.includes(owner)) return null;
    return { owner, repo };
  }

  function createBadge() {
    const existing = document.getElementById("realstars-badge");
    if (existing) existing.remove();

    const badge = document.createElement("span");
    badge.id = "realstars-badge";
    badge.className = "loading";
    badge.innerHTML = '<span class="rs-icon">&#x27F3;</span> Checking stars...';
    badge.addEventListener("click", togglePanel);
    return badge;
  }

  function injectBadge(badge) {
    // Try to inject near the star count button on GitHub
    const starButton =
      document.querySelector('[data-view-component="true"].starring-container') ||
      document.querySelector(".starring-container") ||
      document.querySelector('[aria-label="Star this repository"]')?.closest("div");

    if (starButton && starButton.parentElement) {
      starButton.parentElement.insertBefore(badge, starButton.nextSibling);
      return true;
    }

    // Fallback: inject into repo header area
    const repoHeader =
      document.querySelector(".AppHeader-context-full") ||
      document.querySelector("[data-testid='repository-title']") ||
      document.querySelector(".repohead");

    if (repoHeader) {
      repoHeader.appendChild(badge);
      return true;
    }

    return false;
  }

  function updateBadge(result) {
    const badge = document.getElementById("realstars-badge");
    if (!badge) return;

    if (result.error) {
      badge.className = "loading";
      if (result.error === "rate_limited") {
        const resetTime = new Date(result.resetAt * 1000).toLocaleTimeString();
        badge.innerHTML = `<span class="rs-icon">&#x26A0;</span> Rate limited (resets ${resetTime})`;
      } else {
        badge.innerHTML = `<span class="rs-icon">&#x26A0;</span> ${result.error}`;
      }
      return;
    }

    const { trust } = result;
    badge.className = `grade-${trust.grade}`;

    const gradeIcons = {
      A: "\u2705",
      B: "\u2714\uFE0F",
      C: "\u26A0\uFE0F",
      D: "\u274C",
      F: "\uD83D\uDEA8",
    };

    badge.innerHTML = `<span class="rs-icon">${gradeIcons[trust.grade]}</span> RealStars: ${trust.grade} (${trust.score}/100)`;
    badge.dataset.result = JSON.stringify(result);
  }

  function togglePanel() {
    const badge = document.getElementById("realstars-badge");
    if (!badge || !badge.dataset.result) return;

    let panel = document.getElementById("realstars-panel");
    if (panel && !panelOpen) {
      panel.classList.remove("hidden");
      panelOpen = true;
      return;
    }
    if (panel && panelOpen) {
      panel.classList.add("hidden");
      panelOpen = false;
      return;
    }

    const result = JSON.parse(badge.dataset.result);
    panel = createPanel(result);
    document.body.appendChild(panel);
    // Trigger reflow for animation
    panel.offsetHeight;
    panel.classList.remove("hidden");
    panelOpen = true;
  }

  function createPanel(result) {
    const { repoInfo, stargazerAnalysis, trust, smallRepo } = result;
    const panel = document.createElement("div");
    panel.id = "realstars-panel";
    panel.className = "hidden";

    const gradeColors = {
      A: "#4ac26b",
      B: "#54aeff",
      C: "#d4a72c",
      D: "#ff8182",
      F: "#ff4a4a",
    };
    const color = gradeColors[trust.grade];

    let stargazerHTML = "";
    if (stargazerAnalysis && stargazerAnalysis.sampleSize > 0) {
      stargazerHTML = `
        <div class="rs-stats">
          <h3>Stargazer Profile Analysis (sample: ${stargazerAnalysis.sampleSize})</h3>
          <div class="rs-stat-row">
            <span class="rs-stat-label">Zero public repos</span>
            <span class="rs-stat-value">${stargazerAnalysis.zeroReposPercent}%</span>
          </div>
          <div class="rs-stat-row">
            <span class="rs-stat-label">Zero followers</span>
            <span class="rs-stat-value">${stargazerAnalysis.zeroFollowersPercent}%</span>
          </div>
          <div class="rs-stat-row">
            <span class="rs-stat-label">Ghost accounts</span>
            <span class="rs-stat-value">${stargazerAnalysis.ghostPercent}%</span>
          </div>
          <div class="rs-stat-row">
            <span class="rs-stat-label">Avg public repos</span>
            <span class="rs-stat-value">${stargazerAnalysis.avgPublicRepos}</span>
          </div>
          <div class="rs-stat-row">
            <span class="rs-stat-label">Avg followers</span>
            <span class="rs-stat-value">${stargazerAnalysis.avgFollowers}</span>
          </div>
          <div class="rs-stat-row">
            <span class="rs-stat-label">Median account age</span>
            <span class="rs-stat-value">${stargazerAnalysis.medianAccountAgeDays} days</span>
          </div>
        </div>
      `;
    }

    const signalsHTML = trust.signals
      .map(
        (s) => `
        <div class="rs-signal severity-${s.severity}">
          <div class="rs-signal-title">
            <span>${s.signal}</span>
            <span class="rs-signal-value">${s.value}</span>
          </div>
          <div class="rs-signal-detail">${s.detail}</div>
        </div>
      `
      )
      .join("");

    panel.innerHTML = `
      <div class="rs-header">
        <h2>RealStars Analysis</h2>
        <button class="rs-close">&times;</button>
      </div>
      <div class="rs-score-section">
        <div class="rs-score-circle" style="border-color: ${color}; color: ${color}">
          <span class="rs-grade">${trust.grade}</span>
          <span class="rs-score-num">${trust.score}/100</span>
        </div>
        <div class="rs-label">${trust.label}</div>
        ${smallRepo ? '<div style="font-size:11px;color:#656d76;margin-top:6px;">Small repo (&lt;50 stars) — limited analysis</div>' : ""}
      </div>
      <div class="rs-stats">
        <h3>Repository Metrics</h3>
        <div class="rs-stat-row">
          <span class="rs-stat-label">Stars</span>
          <span class="rs-stat-value">${repoInfo.stars.toLocaleString()}</span>
        </div>
        <div class="rs-stat-row">
          <span class="rs-stat-label">Forks</span>
          <span class="rs-stat-value">${repoInfo.forks.toLocaleString()}</span>
        </div>
        <div class="rs-stat-row">
          <span class="rs-stat-label">Watchers</span>
          <span class="rs-stat-value">${repoInfo.watchers.toLocaleString()}</span>
        </div>
        <div class="rs-stat-row">
          <span class="rs-stat-label">Fork/Star ratio</span>
          <span class="rs-stat-value">${trust.forkRatio.toFixed(3)}</span>
        </div>
        <div class="rs-stat-row">
          <span class="rs-stat-label">Watcher/Star ratio</span>
          <span class="rs-stat-value">${trust.watcherRatio.toFixed(4)}</span>
        </div>
      </div>
      ${stargazerHTML}
      <div class="rs-signals">
        <h3>Trust Signals</h3>
        ${signalsHTML}
      </div>
      <div class="rs-footer">
        Based on CMU StarScout (ICSE 2026) research methodology.<br>
        <a href="https://arxiv.org/abs/2412.13459" target="_blank">Read the paper</a>
      </div>
    `;

    panel.querySelector(".rs-close").addEventListener("click", () => {
      panel.classList.add("hidden");
      panelOpen = false;
    });

    return panel;
  }

  async function analyzeCurrentPage() {
    const repo = getRepoFromUrl();
    if (!repo) return;

    // Avoid re-analyzing the same repo
    const repoKey = `${repo.owner}/${repo.repo}`;
    if (currentRepo === repoKey && document.getElementById("realstars-badge"))
      return;
    currentRepo = repoKey;

    // Remove old panel
    const oldPanel = document.getElementById("realstars-panel");
    if (oldPanel) oldPanel.remove();
    panelOpen = false;

    const badge = createBadge();
    // Retry injection a few times (GitHub loads dynamically)
    let injected = false;
    for (let i = 0; i < 5; i++) {
      injected = injectBadge(badge);
      if (injected) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!injected) return;

    try {
      const result = await chrome.runtime.sendMessage({
        type: "ANALYZE_REPO",
        owner: repo.owner,
        repo: repo.repo,
      });
      updateBadge(result);
    } catch (err) {
      updateBadge({ error: err.message });
    }
  }

  // Run on page load
  analyzeCurrentPage();

  // Re-run on SPA navigation (GitHub uses Turbo/pjax)
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      currentRepo = null;
      analyzeCurrentPage();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
