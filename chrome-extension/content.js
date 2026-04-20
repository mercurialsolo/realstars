// RealStars - Content Script
// Injects trust badge into GitHub repository pages

(function () {
  "use strict";

  const MIN_STARS = 10; // Don't show badge for repos with fewer stars
  let currentRepo = null;
  let panelOpen = false;

  function getRepoFromUrl() {
    const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/?/);
    if (!match) return null;
    const owner = match[1];
    const repo = match[2];
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

  function removeBadge() {
    const badge = document.getElementById("realstars-badge");
    if (badge) badge.remove();
    const panel = document.getElementById("realstars-panel");
    if (panel) panel.remove();
    panelOpen = false;
  }

  function createBadge() {
    removeBadge();
    const badge = document.createElement("span");
    badge.id = "realstars-badge";
    badge.className = "loading";
    badge.innerHTML = '<span class="rs-icon">&#x27F3;</span> Checking...';
    badge.addEventListener("click", togglePanel);
    return badge;
  }

  function injectBadge(badge) {
    // GitHub DOM structure (verified via inspection):
    //   <div class="d-flex flex-nowrap flex-justify-end ...">   <-- flex parent
    //     <div id="repository-details-container" class="flex-shrink-0">
    //       <ul class="pagehead-actions ... d-md-inline">
    //         <li style="float:left">Pin</li>
    //         <li style="float:left">Watch</li>
    //         <li style="float:left">Fork</li>
    //         <li style="float:left">Star</li>
    //       </ul>
    //     </div>
    //   </div>
    //
    // The <ul> uses float-based layout (not flex), so adding children causes wrapping.
    // Instead, inject the badge as a sibling of #repository-details-container
    // inside the flex-nowrap parent — guaranteed inline.

    const detailsContainer = document.getElementById("repository-details-container");
    if (detailsContainer && detailsContainer.parentElement) {
      const flexParent = detailsContainer.parentElement;
      flexParent.appendChild(badge);
      return true;
    }

    // Fallback: look for the pagehead-actions UL's parent
    const ul = document.querySelector("ul.pagehead-actions");
    if (ul && ul.parentElement && ul.parentElement.parentElement) {
      ul.parentElement.parentElement.appendChild(badge);
      return true;
    }

    return false;
  }

  function updateBadge(result) {
    const badge = document.getElementById("realstars-badge");
    if (!badge) return;

    // Hide badge if insufficient data
    if (result.hide) {
      removeBadge();
      return;
    }

    if (result.error && !result.trust) {
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

    const suffix = result.rateLimited ? " (ratios only)" : "";
    badge.innerHTML = `<span class="rs-icon">${gradeIcons[trust.grade]}</span> RealStars: ${trust.grade} (${trust.score}/100)${suffix}`;
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
            <span class="rs-stat-label">Zero-activity accounts</span>
            <span class="rs-stat-value">${stargazerAnalysis.zeroStarsPercent}%</span>
          </div>
          <div class="rs-stat-row">
            <span class="rs-stat-label">Default avatar (no picture)</span>
            <span class="rs-stat-value">${stargazerAnalysis.defaultAvatarPercent}%</span>
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
        ${smallRepo ? '<div style="font-size:11px;color:#656d76;margin-top:6px;">Small repo — limited analysis</div>' : ""}
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

  function parseCount(text) {
    if (!text) return null;
    text = text.trim().replace(/,/g, "");
    if (text.endsWith("k")) return Math.round(parseFloat(text) * 1000);
    if (text.endsWith("m")) return Math.round(parseFloat(text) * 1000000);
    const n = parseInt(text, 10);
    return isNaN(n) ? null : n;
  }

  function scrapePageCounts() {
    let stars = null, forks = null, watchers = null;

    const starCounter =
      document.querySelector("#repo-stars-counter-star") ||
      document.querySelector("[id*='star-button'] .Counter") ||
      document.querySelector(".starring-container .Counter") ||
      document.querySelector("a[href$='/stargazers'] .Counter");
    if (starCounter) stars = parseCount(starCounter.textContent);

    const forkCounter =
      document.querySelector("#repo-network-counter") ||
      document.querySelector("a[href$='/forks'] .Counter") ||
      document.querySelector(".forks .Counter");
    if (forkCounter) forks = parseCount(forkCounter.textContent);

    const watchCounter =
      document.querySelector("a[href$='/watchers'] .Counter") ||
      document.querySelector(".watchers .Counter");
    if (watchCounter) watchers = parseCount(watchCounter.textContent);

    return { stars, forks, watchers };
  }

  async function analyzeCurrentPage() {
    const repo = getRepoFromUrl();
    if (!repo) return;

    const repoKey = `${repo.owner}/${repo.repo}`;
    if (currentRepo === repoKey && document.getElementById("realstars-badge"))
      return;
    currentRepo = repoKey;

    removeBadge();

    // Quick check: if we can read star count from the page and it's < MIN_STARS, skip
    const pageData = scrapePageCounts();
    if (pageData.stars !== null && pageData.stars < MIN_STARS) return;

    const badge = createBadge();
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
        pageData,
      });
      updateBadge(result);
    } catch (err) {
      updateBadge({ error: err.message });
    }
  }

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
