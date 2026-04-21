// Module 1: Repo Metrics & Ratios (weight: 0.12)

import { githubFetch } from "./github-api.js";
import { getCached, setCache } from "./cache.js";

export async function fetchRepoInfo(owner, repo, token) {
  const key = `repo:${owner}/${repo}`;
  const cached = getCached(key);
  if (cached) return cached;

  const data = await githubFetch(
    `https://api.github.com/repos/${owner}/${repo}`,
    token
  );

  const result = {
    stars: data.stargazers_count,
    forks: data.forks_count,
    watchers: data.subscribers_count,
    issues: data.open_issues_count,
    language: data.language,
    topics: data.topics || [],
    createdAt: data.created_at,
    description: data.description,
    defaultBranch: data.default_branch,
    fullName: data.full_name,
    isPrivate: !!data.private,
  };
  setCache(key, result);
  return result;
}

export function analyzeRepoMetrics(repoInfo) {
  const signals = [];
  let subscore = 1.0;

  const stars = repoInfo.stars;
  if (stars === 0) return { subscore: 0.5, signals: [] };

  // Fork/star ratio (organic ~0.16, suspicious < 0.05)
  const forkRatio = repoInfo.forks / stars;
  if (forkRatio < 0.02) {
    subscore -= 0.5;
    signals.push({
      signal: "Very low fork/star ratio",
      value: forkRatio.toFixed(4),
      severity: "high",
      detail: "Organic repos average ~0.16. Below 0.02 is a strong fake signal.",
      category: "ratio",
    });
  } else if (forkRatio < 0.05) {
    subscore -= 0.3;
    signals.push({
      signal: "Low fork/star ratio",
      value: forkRatio.toFixed(4),
      severity: "medium",
      detail: "Below 0.05 warrants scrutiny per CMU research.",
      category: "ratio",
    });
  } else {
    signals.push({
      signal: "Fork/star ratio normal",
      value: forkRatio.toFixed(4),
      severity: "ok",
      detail: "Within normal range (organic avg ~0.16).",
      category: "ratio",
    });
  }

  // Watcher/star ratio (healthy 0.005-0.03, suspicious < 0.001)
  const watcherRatio = repoInfo.watchers / stars;
  if (watcherRatio < 0.001) {
    subscore -= 0.35;
    signals.push({
      signal: "Very low watcher/star ratio",
      value: watcherRatio.toFixed(5),
      severity: "high",
      detail: "Healthy repos: 0.005-0.030. Below 0.001 suggests inflated stars.",
      category: "ratio",
    });
  } else if (watcherRatio < 0.005) {
    subscore -= 0.15;
    signals.push({
      signal: "Low watcher/star ratio",
      value: watcherRatio.toFixed(5),
      severity: "medium",
      detail: "Slightly below healthy range of 0.005-0.030.",
      category: "ratio",
    });
  } else {
    signals.push({
      signal: "Watcher/star ratio normal",
      value: watcherRatio.toFixed(5),
      severity: "ok",
      detail: "Within healthy range (0.005-0.030).",
      category: "ratio",
    });
  }

  subscore = Math.max(0, Math.min(1, subscore));
  return { subscore, signals, forkRatio, watcherRatio };
}
