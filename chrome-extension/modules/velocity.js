// Module 10: Star Velocity vs Releases (weight: 0.05)

import { githubFetch } from "./github-api.js";

export async function analyzeVelocityVsReleases(owner, repo, token, starTimingBursts) {
  const signals = [];
  let subscore = 1.0;

  if (!starTimingBursts || starTimingBursts.length === 0) {
    signals.push({
      signal: "No bursts to correlate",
      value: "N/A",
      severity: "ok",
      detail: "No star bursts detected, so velocity/release correlation is not applicable.",
      category: "velocity",
    });
    return { unmatchedBursts: 0, subscore: 1.0, signals };
  }

  let releases = [];
  try {
    releases = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`,
      token
    );
    if (!Array.isArray(releases)) releases = [];
  } catch (e) {
    if (e.message.startsWith("RATE_LIMITED")) throw e;
    signals.push({
      signal: "Could not fetch releases",
      value: "API error",
      severity: "ok",
      detail: "Unable to correlate star bursts with releases.",
      category: "velocity",
    });
    return { unmatchedBursts: 0, subscore: 0.5, signals };
  }

  if (releases.length === 0) {
    if (starTimingBursts.length > 0) {
      subscore -= 0.3;
      signals.push({
        signal: "Star bursts with no releases",
        value: `${starTimingBursts.length} burst(s), 0 releases`,
        severity: "medium",
        detail: "Star spikes occurred but repo has no releases to explain them.",
        category: "velocity",
      });
    }
    return { unmatchedBursts: starTimingBursts.length, subscore, signals };
  }

  const releaseDates = releases
    .map((r) => new Date(r.published_at || r.created_at).getTime())
    .filter((t) => !isNaN(t));

  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  let unmatchedBursts = 0;

  for (const burst of starTimingBursts) {
    const burstDate = new Date(burst.date).getTime();
    const correlatesWithRelease = releaseDates.some(
      (releaseDate) => Math.abs(burstDate - releaseDate) <= sevenDaysMs
    );
    if (!correlatesWithRelease) unmatchedBursts++;
  }

  if (unmatchedBursts > 0 && unmatchedBursts === starTimingBursts.length) {
    subscore -= 0.5;
    signals.push({
      signal: "All bursts uncorrelated with releases",
      value: `${unmatchedBursts}/${starTimingBursts.length} bursts unmatched`,
      severity: "high",
      detail: "Star spikes do not coincide with any release within 7 days.",
      category: "velocity",
    });
  } else if (unmatchedBursts > 0) {
    subscore -= 0.25;
    signals.push({
      signal: "Some bursts uncorrelated with releases",
      value: `${unmatchedBursts}/${starTimingBursts.length} bursts unmatched`,
      severity: "medium",
      detail: "Some star spikes have no corresponding release.",
      category: "velocity",
    });
  } else {
    signals.push({
      signal: "Bursts correlate with releases",
      value: `All ${starTimingBursts.length} burst(s) match releases`,
      severity: "ok",
      detail: "Star spikes correspond to release events — organic signal.",
      category: "velocity",
    });
  }

  subscore = Math.max(0, Math.min(1, subscore));
  return { unmatchedBursts, subscore, signals };
}
