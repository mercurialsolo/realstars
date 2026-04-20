// Module 3: Star Timing Analysis (weight: 0.15)

import { githubFetch } from "./github-api.js";
import { getCached, setCache } from "./cache.js";

export async function analyzeStarTiming(owner, repo, token, starCount) {
  const key = `startiming:${owner}/${repo}`;
  const cached = getCached(key);
  if (cached) return cached;

  const signals = [];
  let subscore = 1.0;

  const perPage = 30;
  const totalPages = Math.ceil(starCount / perPage);

  const pagesToFetch = [];
  if (totalPages <= 4) {
    for (let i = 1; i <= totalPages; i++) pagesToFetch.push(i);
  } else {
    const step = Math.max(1, Math.floor(totalPages / 4));
    pagesToFetch.push(1, step, step * 2, totalPages);
  }

  let allTimestamps = [];
  for (const page of pagesToFetch) {
    try {
      const data = await githubFetch(
        `https://api.github.com/repos/${owner}/${repo}/stargazers?per_page=${perPage}&page=${page}`,
        token,
        { accept: "application/vnd.github.v3.star+json" }
      );
      if (Array.isArray(data)) {
        for (const entry of data) {
          if (entry.starred_at) {
            allTimestamps.push(new Date(entry.starred_at).getTime());
          }
        }
      }
    } catch (e) {
      if (e.message.startsWith("RATE_LIMITED")) throw e;
    }
  }

  if (allTimestamps.length < 5) {
    const result = { bursts: [], uniformScore: 0, oddHoursPercent: 0, subscore: 0.5, signals: [] };
    setCache(key, result);
    return result;
  }

  allTimestamps.sort((a, b) => a - b);

  // --- Burst detection ---
  const dayBuckets = {};
  for (const ts of allTimestamps) {
    const day = new Date(ts).toISOString().slice(0, 10);
    dayBuckets[day] = (dayBuckets[day] || 0) + 1;
  }

  const dailyCounts = Object.values(dayBuckets);
  dailyCounts.sort((a, b) => a - b);
  const medianDaily = dailyCounts.length > 0
    ? dailyCounts[Math.floor(dailyCounts.length / 2)]
    : 1;

  const bursts = [];
  for (const [day, count] of Object.entries(dayBuckets)) {
    if (count > medianDaily * 10 && count > 5) {
      bursts.push({ date: day, count, ratio: Math.round(count / Math.max(medianDaily, 1)) });
    }
  }

  if (bursts.length > 0) {
    const burstSeverity = bursts.length >= 3 ? 0.5 : 0.25;
    subscore -= burstSeverity;
    signals.push({
      signal: "Star bursts detected",
      value: `${bursts.length} burst(s), max ${Math.max(...bursts.map(b => b.ratio))}x median`,
      severity: bursts.length >= 3 ? "high" : "medium",
      detail: `Days with star rate >10x the median daily rate: ${bursts.map(b => b.date).join(", ")}`,
      category: "timing",
    });
  } else {
    signals.push({
      signal: "No star bursts",
      value: "Consistent growth pattern",
      severity: "ok",
      detail: "No days with anomalous star spikes detected in sample.",
      category: "timing",
    });
  }

  // --- Uniform spacing detection ---
  const gaps = [];
  for (let i = 1; i < allTimestamps.length; i++) {
    gaps.push(allTimestamps[i] - allTimestamps[i - 1]);
  }

  let uniformScore = 0;
  if (gaps.length > 2) {
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((sum, g) => sum + Math.pow(g - meanGap, 2), 0) / gaps.length;
    const stddev = Math.sqrt(variance);
    const cv = meanGap > 0 ? stddev / meanGap : 0;

    if (cv < 0.2 && gaps.length > 10) {
      uniformScore = 0.9;
      subscore -= 0.3;
      signals.push({
        signal: "Suspiciously uniform star spacing",
        value: `CV=${cv.toFixed(3)}`,
        severity: "high",
        detail: "Time between stars is very regular, indicating automated behavior.",
        category: "timing",
      });
    } else if (cv < 0.4 && gaps.length > 10) {
      uniformScore = 0.5;
      subscore -= 0.1;
      signals.push({
        signal: "Somewhat uniform star spacing",
        value: `CV=${cv.toFixed(3)}`,
        severity: "medium",
        detail: "Time gaps between stars are more regular than typical organic patterns.",
        category: "timing",
      });
    } else {
      uniformScore = cv > 1 ? 0 : 0.2;
      signals.push({
        signal: "Natural star spacing",
        value: `CV=${cv.toFixed(3)}`,
        severity: "ok",
        detail: "Time gaps show natural variance expected from organic starring.",
        category: "timing",
      });
    }
  }

  // --- Odd-hours detection ---
  let oddHoursCount = 0;
  for (const ts of allTimestamps) {
    const hour = new Date(ts).getUTCHours();
    if (hour >= 1 && hour <= 5) oddHoursCount++;
  }
  const oddHoursPercent = (oddHoursCount / allTimestamps.length) * 100;

  if (oddHoursPercent > 50) {
    subscore -= 0.2;
    signals.push({
      signal: "High odd-hours starring",
      value: `${oddHoursPercent.toFixed(1)}%`,
      severity: "high",
      detail: "Over 50% of stars given between 1-5am UTC. Expected ~17%.",
      category: "timing",
    });
  } else if (oddHoursPercent > 35) {
    subscore -= 0.1;
    signals.push({
      signal: "Elevated odd-hours starring",
      value: `${oddHoursPercent.toFixed(1)}%`,
      severity: "medium",
      detail: "Above expected ~17% baseline for 1-5am UTC window.",
      category: "timing",
    });
  } else {
    signals.push({
      signal: "Normal hour distribution",
      value: `${oddHoursPercent.toFixed(1)}% in 1-5am UTC`,
      severity: "ok",
      detail: "Star times follow expected global distribution.",
      category: "timing",
    });
  }

  subscore = Math.max(0, Math.min(1, subscore));
  const result = { bursts, uniformScore, oddHoursPercent, subscore, signals };
  setCache(key, result);
  return result;
}
