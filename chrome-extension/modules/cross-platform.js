// Module 8: Cross-Platform Correlation (weight: 0.05)

import { githubFetch } from "./github-api.js";

export async function analyzeCrossPlatform(repoInfo, owner, repo, token) {
  const signals = [];
  let subscore = 0.5;

  const language = (repoInfo.language || "").toLowerCase();
  const topics = (repoInfo.topics || []).map((t) => t.toLowerCase());

  let packageManager = null;
  let packageName = null;

  if (
    language === "javascript" ||
    language === "typescript" ||
    topics.includes("npm") ||
    topics.includes("node") ||
    topics.includes("nodejs")
  ) {
    packageManager = "npm";
    packageName = repo;
  }

  if (
    language === "python" ||
    topics.includes("pypi") ||
    topics.includes("pip")
  ) {
    packageManager = "pypi";
    packageName = repo;
  }

  if (!packageManager) {
    try {
      await githubFetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/package.json`,
        token
      );
      packageManager = "npm";
      packageName = repo;
    } catch {
      // Not an npm package
    }
  }

  if (!packageManager) {
    try {
      await githubFetch(
        `https://api.github.com/repos/${owner}/${repo}/contents/setup.py`,
        token
      );
      packageManager = "pypi";
      packageName = repo;
    } catch {
      try {
        await githubFetch(
          `https://api.github.com/repos/${owner}/${repo}/contents/pyproject.toml`,
          token
        );
        packageManager = "pypi";
        packageName = repo;
      } catch {
        // Not a Python package either
      }
    }
  }

  if (!packageManager) {
    signals.push({
      signal: "Package manager not detected",
      value: "N/A",
      severity: "ok",
      detail: "Could not identify package registry. Module skipped.",
      category: "cross-platform",
    });
    return { manager: null, downloads: null, ratio: null, subscore: 0.5, signals };
  }

  let downloads = null;
  try {
    if (packageManager === "npm") {
      const resp = await fetch(
        `https://api.npmjs.org/downloads/point/last-month/${packageName}`
      );
      if (resp.ok) {
        const data = await resp.json();
        downloads = data.downloads || 0;
      }
    } else if (packageManager === "pypi") {
      const resp = await fetch(
        `https://pypistats.org/api/packages/${packageName}/recent`
      );
      if (resp.ok) {
        const data = await resp.json();
        downloads = data.data ? data.data.last_month || 0 : 0;
      }
    }
  } catch {
    // External API unavailable
  }

  if (downloads === null) {
    signals.push({
      signal: "Download data unavailable",
      value: `${packageManager}:${packageName}`,
      severity: "ok",
      detail: "Could not fetch download stats. Package may not be published.",
      category: "cross-platform",
    });
    return { manager: packageManager, downloads: null, ratio: null, subscore: 0.5, signals };
  }

  const stars = repoInfo.stars;
  const downloadStarRatio = stars > 0 ? downloads / stars : 0;

  if (downloads < 100 && stars > 1000) {
    subscore = 0.15;
    signals.push({
      signal: "Extreme download/star mismatch",
      value: `${downloads} downloads / ${stars} stars`,
      severity: "high",
      detail: `${packageManager} package has almost no downloads despite many stars.`,
      category: "cross-platform",
    });
  } else if (downloadStarRatio < 1 && stars > 500) {
    subscore = 0.3;
    signals.push({
      signal: "Low download/star ratio",
      value: `ratio=${downloadStarRatio.toFixed(2)} (${downloads} downloads)`,
      severity: "medium",
      detail: "Popular packages typically have downloads >> stars.",
      category: "cross-platform",
    });
  } else if (downloadStarRatio > 10) {
    subscore = 0.9;
    signals.push({
      signal: "Strong download/star correlation",
      value: `${downloads.toLocaleString()} downloads / ${stars} stars`,
      severity: "ok",
      detail: "Package downloads align with star count — organic signal.",
      category: "cross-platform",
    });
  } else {
    subscore = 0.6;
    signals.push({
      signal: "Download/star ratio acceptable",
      value: `ratio=${downloadStarRatio.toFixed(2)}`,
      severity: "ok",
      detail: "Downloads and stars are in reasonable proportion.",
      category: "cross-platform",
    });
  }

  return {
    manager: packageManager,
    downloads,
    ratio: downloadStarRatio ? Math.round(downloadStarRatio * 100) / 100 : null,
    subscore,
    signals,
  };
}
