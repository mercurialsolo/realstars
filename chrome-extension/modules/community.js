// Module 2: Community Engagement (weight: 0.08)

import { githubFetch } from "./github-api.js";

export async function analyzeCommunity(owner, repo, token, repoInfo) {
  const signals = [];
  let subscore = 1.0;

  const stars = repoInfo.stars;
  const issueCount = repoInfo.issues;

  let contributorCount = 0;
  try {
    const contribPage = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=100&anon=true`,
      token
    );
    contributorCount = Array.isArray(contribPage) ? contribPage.length : 0;
  } catch (e) {
    if (e.message.startsWith("RATE_LIMITED")) throw e;
    contributorCount = 0;
  }

  // Issue/star ratio (organic: 0.01-0.05, suspicious: < 0.001)
  const issueStarRatio = stars > 0 ? issueCount / stars : 0;
  if (issueStarRatio < 0.001 && stars > 100) {
    subscore -= 0.4;
    signals.push({
      signal: "Very low issue/star ratio",
      value: issueStarRatio.toFixed(5),
      severity: "high",
      detail: "Organic repos with 100+ stars typically have issues. Ratio < 0.001 is suspicious.",
      category: "community",
    });
  } else if (issueStarRatio < 0.005 && stars > 100) {
    subscore -= 0.2;
    signals.push({
      signal: "Low issue/star ratio",
      value: issueStarRatio.toFixed(5),
      severity: "medium",
      detail: "Below typical organic range of 0.01-0.05.",
      category: "community",
    });
  } else {
    signals.push({
      signal: "Issue/star ratio",
      value: issueStarRatio.toFixed(5),
      severity: "ok",
      detail: "Within acceptable range.",
      category: "community",
    });
  }

  // Contributor/star ratio
  const contributorStarRatio = stars > 0 ? contributorCount / stars : 0;
  if (contributorCount < 2 && stars > 200) {
    subscore -= 0.3;
    signals.push({
      signal: "Very few contributors for star count",
      value: `${contributorCount} contributors / ${stars} stars`,
      severity: "high",
      detail: "Popular repos with many stars typically attract contributors.",
      category: "community",
    });
  } else if (contributorStarRatio < 0.001 && stars > 100) {
    subscore -= 0.15;
    signals.push({
      signal: "Low contributor/star ratio",
      value: contributorStarRatio.toFixed(5),
      severity: "medium",
      detail: "Few contributors relative to star count.",
      category: "community",
    });
  } else {
    signals.push({
      signal: "Contributor engagement",
      value: `${contributorCount} contributors`,
      severity: "ok",
      detail: "Healthy contributor engagement.",
      category: "community",
    });
  }

  subscore = Math.max(0, Math.min(1, subscore));
  return {
    issueCount,
    contributorCount,
    issueStarRatio,
    contributorStarRatio,
    subscore,
    signals,
  };
}
