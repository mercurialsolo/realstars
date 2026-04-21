// RealStars - Content Script
// Injects trust badge and intelligence side panel into GitHub repository pages

(function () {
  "use strict";

  const MIN_STARS = 10;
  let currentRepo = null;
  let panelOpen = false;

  // --- Utility helpers ---

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

  function parseCount(text) {
    if (!text) return null;
    text = text.trim().replace(/,/g, "");
    if (text.endsWith("k")) return Math.round(parseFloat(text) * 1000);
    if (text.endsWith("m")) return Math.round(parseFloat(text) * 1000000);
    const n = parseInt(text, 10);
    return isNaN(n) ? null : n;
  }

  function isPrivateRepo() {
    // GitHub renders a "Private" label/badge on private repo pages
    const label = document.querySelector(".Label--secondary");
    if (label && label.textContent.trim().toLowerCase() === "private") return true;
    // Also check the repo visibility span used in newer layouts
    const visibility = document.querySelector("[data-testid='repo-title-component'] .Label");
    if (visibility && visibility.textContent.trim().toLowerCase() === "private") return true;
    return false;
  }

  function scrapePageCounts() {
    let stars = null,
      forks = null,
      watchers = null;

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

  function fmt(n) {
    if (n == null || n === undefined) return "N/A";
    if (typeof n === "number") return n.toLocaleString();
    return String(n);
  }

  function pct(n) {
    if (n == null || n === undefined) return "N/A";
    return typeof n === "number" ? n.toFixed(1) + "%" : String(n);
  }

  function dec(n, places) {
    if (n == null || n === undefined) return "N/A";
    return typeof n === "number" ? n.toFixed(places) : String(n);
  }

  // --- Badge logic ---

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
    const detailsContainer = document.getElementById(
      "repository-details-container"
    );
    if (detailsContainer && detailsContainer.parentElement) {
      const flexParent = detailsContainer.parentElement;
      flexParent.appendChild(badge);
      return true;
    }

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

    const { trust, historical } = result;
    badge.className = `grade-${trust.grade}`;

    let trendArrow = "";
    if (historical && historical.previousScore != null) {
      const diff = trust.score - historical.previousScore;
      if (diff > 2) trendArrow = " \u2191";
      else if (diff < -2) trendArrow = " \u2193";
      else trendArrow = " \u2192";
    }

    badge.innerHTML = `<span class="rs-icon">\u2B50</span> RealStars: ${trust.grade} (${trust.score}/100)${trendArrow}`;
    badge.dataset.result = JSON.stringify(result);
  }

  // --- Panel logic ---

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
    // Force reflow then reveal
    panel.offsetHeight;
    panel.classList.remove("hidden");
    panelOpen = true;
  }

  function getSeverityForSubscore(subscore) {
    if (subscore >= 80) return "ok";
    if (subscore >= 50) return "medium";
    return "high";
  }

  function getGradeColor(grade) {
    const colors = {
      A: "#4ac26b",
      B: "#54aeff",
      C: "#d4a72c",
      D: "#ff8182",
      F: "#ff4a4a",
    };
    return colors[grade] || "#656d76";
  }

  function getSeverityColor(severity) {
    if (severity === "ok") return "#4ac26b";
    if (severity === "medium") return "#d4a72c";
    return "#ff4a4a";
  }

  function buildSignalItem(signal) {
    const severity = signal.severity || "ok";
    return `
      <div class="rs-signal-item severity-${severity}">
        <div class="rs-signal-row">
          <span class="rs-signal-name">${signal.signal || signal.name || ""}</span>
          <span class="rs-signal-value">${signal.value != null ? signal.value : ""}</span>
        </div>
        ${signal.detail ? `<div class="rs-signal-detail">${signal.detail}</div>` : ""}
      </div>
    `;
  }

  function buildCategory(id, icon, title, subscore, signals) {
    const severity = getSeverityForSubscore(subscore);
    const dotColor = getSeverityColor(severity);
    const signalItems = (signals || []).map(buildSignalItem).join("");
    const scoreDisplay =
      subscore != null ? `<span class="rs-cat-score">${subscore}/100</span>` : "";

    return `
      <div class="rs-category" data-category="${id}">
        <button class="rs-cat-header" aria-expanded="false">
          <span class="rs-cat-left">
            <span class="rs-cat-arrow">\u25B6</span>
            <span class="rs-cat-icon">${icon}</span>
            <span class="rs-cat-title">${title}</span>
          </span>
          <span class="rs-cat-right">
            ${scoreDisplay}
            <span class="rs-cat-dot" style="background:${dotColor}"></span>
          </span>
        </button>
        <div class="rs-cat-body">
          ${signalItems || '<div class="rs-no-signals">No signals detected</div>'}
        </div>
      </div>
    `;
  }

  function buildBreakdownBar(result) {
    const categories = [
      { key: "starTiming", label: "Timing", color: "#6366f1" },
      { key: "profiles", label: "Profiles", color: "#8b5cf6" },
      { key: "community", label: "Community", color: "#06b6d4" },
      { key: "creationClustering", label: "Clustering", color: "#f59e0b" },
      { key: "overlap", label: "Overlap", color: "#ef4444" },
      { key: "usernamePatterns", label: "Usernames", color: "#ec4899" },
      { key: "crossPlatform", label: "Cross-Plat", color: "#10b981" },
      { key: "geographic", label: "Geo", color: "#14b8a6" },
      { key: "velocity", label: "Velocity", color: "#f97316" },
      { key: "blocklist", label: "Blocklist", color: "#dc2626" },
    ];

    const weights = result.trust && result.trust.weights ? result.trust.weights : {};
    let segments = [];
    let totalWeight = 0;

    for (const cat of categories) {
      const w = weights[cat.key] || 0;
      if (w > 0) totalWeight += w;
    }

    if (totalWeight === 0) return "";

    for (const cat of categories) {
      const w = weights[cat.key] || 0;
      if (w <= 0) continue;
      const widthPct = (w / totalWeight) * 100;
      const sub = result[cat.key];
      const subscore = sub ? sub.subscore : 100;
      const opacity = subscore != null ? Math.max(0.3, subscore / 100) : 1;
      segments.push(
        `<div class="rs-bar-segment" style="width:${widthPct}%;background:${cat.color};opacity:${opacity}" title="${cat.label}: ${subscore != null ? subscore + "/100" : "N/A"} (weight: ${(w * 100).toFixed(0)}%)"></div>`
      );
    }

    return `
      <div class="rs-breakdown">
        <div class="rs-breakdown-label">Score Breakdown</div>
        <div class="rs-breakdown-bar">${segments.join("")}</div>
        <div class="rs-breakdown-legend">
          ${categories
            .filter((c) => (weights[c.key] || 0) > 0)
            .map(
              (c) =>
                `<span class="rs-legend-item"><span class="rs-legend-dot" style="background:${c.color}"></span>${c.label}</span>`
            )
            .join("")}
        </div>
      </div>
    `;
  }

  function createPanel(result) {
    const { repoInfo, trust, historical, analysisDepth } = result;
    const panel = document.createElement("div");
    panel.id = "realstars-panel";
    panel.className = "hidden";

    const gradeColor = getGradeColor(trust.grade);

    // Depth label
    const depthLabels = { quick: "Quick", standard: "Standard", deep: "Deep" };
    const depthLabel = depthLabels[analysisDepth] || "Standard";

    // Historical trend
    let trendHTML = "";
    if (historical && historical.previousScore != null) {
      const diff = trust.score - historical.previousScore;
      let arrow, trendClass;
      if (diff > 2) {
        arrow = "\u2191";
        trendClass = "trend-up";
      } else if (diff < -2) {
        arrow = "\u2193";
        trendClass = "trend-down";
      } else {
        arrow = "\u2192";
        trendClass = "trend-stable";
      }
      trendHTML = `
        <div class="rs-trend ${trendClass}">
          <span class="rs-trend-arrow">${arrow}</span>
          <span class="rs-trend-text">Previously ${historical.previousScore}/100${historical.previousDate ? " on " + historical.previousDate : ""}</span>
        </div>
      `;
    }

    // Score breakdown bar
    const breakdownHTML = buildBreakdownBar(result);

    // Categories
    const starTimingSub = result.starTiming || {};
    const profilesSub = result.profiles || {};
    const communitySub = result.community || {};
    const clusteringSub = result.creationClustering || {};
    const overlapSub = result.overlap || {};
    const usernameSub = result.usernamePatterns || {};
    const crossPlatSub = result.crossPlatform || {};
    const geoSub = result.geographic || {};
    const velocitySub = result.velocity || {};
    const blocklistSub = result.blocklist || {};

    const categoriesHTML = [
      buildCategory(
        "starTiming",
        "\u23F1",
        "Star Timing",
        starTimingSub.subscore,
        starTimingSub.signals
      ),
      buildCategory(
        "profiles",
        "\u{1F464}",
        "Profile Quality",
        profilesSub.subscore,
        profilesSub.signals
      ),
      buildCategory(
        "community",
        "\u{1F4CA}",
        "Engagement Ratios",
        communitySub.subscore,
        communitySub.signals
      ),
      buildCategory(
        "creationClustering",
        "\u{1F4C5}",
        "Account Clustering",
        clusteringSub.subscore,
        clusteringSub.signals
      ),
      buildCategory(
        "overlap",
        "\u{1F578}",
        "Stargazer Overlap",
        overlapSub.subscore,
        overlapSub.signals
      ),
      buildCategory(
        "usernamePatterns",
        "\u{1F524}",
        "Username Patterns",
        usernameSub.subscore,
        usernameSub.signals
      ),
      buildCategory(
        "community_health",
        "\u{1F465}",
        "Community Health",
        communitySub.subscore,
        communitySub.signals
      ),
      buildCategory(
        "crossPlatform",
        "\u{1F4E6}",
        "Cross-Platform",
        crossPlatSub.subscore,
        crossPlatSub.signals
      ),
      buildCategory(
        "geographic",
        "\u{1F30D}",
        "Geographic",
        geoSub.subscore,
        geoSub.signals
      ),
      buildCategory(
        "velocity",
        "\u{1F680}",
        "Star Velocity",
        velocitySub.subscore,
        velocitySub.signals
      ),
      buildCategory(
        "blocklist",
        "\u{1F6E1}",
        "Known Farms",
        blocklistSub.subscore,
        blocklistSub.signals
      ),
    ].join("");

    // Raw metrics
    const ri = repoInfo || {};
    const metricsRows = [
      { label: "Stars", value: fmt(ri.stars) },
      { label: "Forks", value: fmt(ri.forks) },
      { label: "Watchers", value: fmt(ri.watchers) },
      { label: "Issues", value: fmt(ri.issues) },
      { label: "Language", value: ri.language || "N/A" },
    ];

    const metricsHTML = metricsRows
      .map(
        (r) => `
      <div class="rs-metric-row">
        <span class="rs-metric-label">${r.label}</span>
        <span class="rs-metric-value">${r.value}</span>
      </div>
    `
      )
      .join("");

    panel.innerHTML = `
      <div class="rs-panel-header">
        <div class="rs-header-left">
          <h2 class="rs-panel-title">RealStars Intelligence</h2>
          <span class="rs-depth-badge">${depthLabel}</span>
        </div>
        <button class="rs-close-btn" aria-label="Close panel">\u2715</button>
      </div>

      <div class="rs-panel-content">
        <div class="rs-hero">
          <div class="rs-hero-circle" style="border-color:${gradeColor};color:${gradeColor}">
            <span class="rs-hero-grade">${trust.grade}</span>
            <span class="rs-hero-score">${trust.score}/100</span>
          </div>
          <div class="rs-hero-label">${trust.label || ""}</div>
          ${trendHTML}
        </div>

        ${breakdownHTML}

        <div class="rs-categories">
          ${categoriesHTML}
        </div>

        <div class="rs-metrics-section">
          <div class="rs-section-title">Repository Metrics</div>
          ${metricsHTML}
        </div>
      </div>

      <div class="rs-panel-footer">
        <div class="rs-footer-line">Based on <a href="https://arxiv.org/abs/2412.13459" target="_blank" rel="noopener">CMU StarScout (ICSE 2026)</a></div>
        <div class="rs-footer-line">Analysis depth: ${depthLabel}</div>
        <div class="rs-footer-line"><a href="https://github.com/AranavMahalpure/realstars" target="_blank" rel="noopener">GitHub</a></div>
      </div>
    `;

    // Bind close button
    panel.querySelector(".rs-close-btn").addEventListener("click", () => {
      panel.classList.add("hidden");
      panelOpen = false;
    });

    // Bind collapsible categories
    panel.querySelectorAll(".rs-cat-header").forEach((btn) => {
      btn.addEventListener("click", () => {
        const expanded = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!expanded));
        const body = btn.nextElementSibling;
        if (expanded) {
          body.style.maxHeight = "0";
        } else {
          body.style.maxHeight = body.scrollHeight + "px";
        }
      });
    });

    return panel;
  }

  // --- Page analysis ---

  async function analyzeCurrentPage() {
    const repo = getRepoFromUrl();
    if (!repo) return;

    const repoKey = `${repo.owner}/${repo.repo}`;
    if (currentRepo === repoKey && document.getElementById("realstars-badge"))
      return;
    currentRepo = repoKey;

    removeBadge();

    // Skip private repositories entirely
    if (isPrivateRepo()) return;

    const pageData = scrapePageCounts();
    if (pageData.stars !== null && pageData.stars < MIN_STARS) return;

    pageData.isPrivate = isPrivateRepo();

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

  // --- Init ---

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
