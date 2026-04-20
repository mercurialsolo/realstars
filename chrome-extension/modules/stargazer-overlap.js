// Module 7: Stargazer Overlap Analysis (weight: 0.12)

import { githubFetch } from "./github-api.js";

export async function analyzeStargazerOverlap(profiles, token, targetRepo) {
  const signals = [];
  let subscore = 1.0;

  if (!profiles || profiles.length < 5) {
    return { checked: false, avgJaccard: 0, commonRepos: [], subscore: 0.5, signals: [] };
  }

  const sampleSize = Math.min(8, profiles.length);
  const step = Math.max(1, Math.floor(profiles.length / sampleSize));
  const selectedProfiles = [];
  for (let i = 0; i < profiles.length && selectedProfiles.length < sampleSize; i += step) {
    selectedProfiles.push(profiles[i]);
  }

  const starredSets = [];
  for (const profile of selectedProfiles) {
    try {
      const starred = await githubFetch(
        `https://api.github.com/users/${profile.login}/starred?per_page=100&sort=created`,
        token
      );
      if (Array.isArray(starred)) {
        const repoNames = starred
          .map((r) => r.full_name)
          .filter((name) => name !== targetRepo);
        starredSets.push(new Set(repoNames));
      } else {
        starredSets.push(new Set());
      }
    } catch (e) {
      if (e.message.startsWith("RATE_LIMITED")) throw e;
      starredSets.push(new Set());
    }
  }

  const validSets = starredSets.filter((s) => s.size > 0);
  if (validSets.length < 2) {
    return { checked: true, avgJaccard: 0, commonRepos: [], subscore: 0.5, signals: [] };
  }

  let totalJaccard = 0;
  let pairCount = 0;

  for (let i = 0; i < validSets.length; i++) {
    for (let j = i + 1; j < validSets.length; j++) {
      const setA = validSets[i];
      const setB = validSets[j];
      let intersection = 0;
      for (const item of setA) {
        if (setB.has(item)) intersection++;
      }
      const union = setA.size + setB.size - intersection;
      const jaccard = union > 0 ? intersection / union : 0;
      totalJaccard += jaccard;
      pairCount++;
    }
  }

  const avgJaccard = pairCount > 0 ? totalJaccard / pairCount : 0;

  const repoFrequency = {};
  for (const s of validSets) {
    for (const repoName of s) {
      repoFrequency[repoName] = (repoFrequency[repoName] || 0) + 1;
    }
  }

  const threshold = Math.ceil(validSets.length * 0.5);
  const commonRepos = Object.entries(repoFrequency)
    .filter(([_, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ repo: name, sharedBy: count }));

  if (avgJaccard > 0.3) {
    subscore -= 0.6;
    signals.push({
      signal: "Very high stargazer overlap",
      value: `Jaccard=${avgJaccard.toFixed(3)}`,
      severity: "high",
      detail: `Sampled stargazers share many of the same starred repos. ${commonRepos.length} repos shared by >50%.`,
      category: "overlap",
    });
  } else if (avgJaccard > 0.15) {
    subscore -= 0.3;
    signals.push({
      signal: "Elevated stargazer overlap",
      value: `Jaccard=${avgJaccard.toFixed(3)}`,
      severity: "medium",
      detail: "Stargazers share more repos in common than typical organic users.",
      category: "overlap",
    });
  } else if (avgJaccard > 0.05) {
    subscore -= 0.1;
    signals.push({
      signal: "Minor stargazer overlap",
      value: `Jaccard=${avgJaccard.toFixed(3)}`,
      severity: "low",
      detail: "Slight overlap, possibly a niche community.",
      category: "overlap",
    });
  } else {
    signals.push({
      signal: "Low stargazer overlap",
      value: `Jaccard=${avgJaccard.toFixed(3)}`,
      severity: "ok",
      detail: "Stargazers have diverse starring patterns — organic signal.",
      category: "overlap",
    });
  }

  subscore = Math.max(0, Math.min(1, subscore));
  return {
    checked: true,
    avgJaccard: Math.round(avgJaccard * 1000) / 1000,
    commonRepos,
    subscore,
    signals,
  };
}
