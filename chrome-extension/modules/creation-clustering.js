// Module 5: Account Creation Date Clustering (weight: 0.10)

export function analyzeCreationClustering(profiles) {
  const signals = [];
  let subscore = 1.0;

  if (!profiles || profiles.length < 5) {
    return { maxClusterPercent: 0, clusterWindow: null, subscore: 0.5, signals: [] };
  }

  const creationDates = profiles
    .filter((p) => p.created_at)
    .map((p) => new Date(p.created_at).getTime());

  if (creationDates.length < 5) {
    return { maxClusterPercent: 0, clusterWindow: null, subscore: 0.5, signals: [] };
  }

  const windowMs = 14 * 24 * 60 * 60 * 1000; // 2 weeks
  const minDate = Math.min(...creationDates);
  const bins = {};

  for (const ts of creationDates) {
    const binIndex = Math.floor((ts - minDate) / windowMs);
    bins[binIndex] = (bins[binIndex] || 0) + 1;
  }

  let maxClusterCount = 0;
  let maxBinIndex = 0;
  for (const [binIdx, count] of Object.entries(bins)) {
    if (count > maxClusterCount) {
      maxClusterCount = count;
      maxBinIndex = parseInt(binIdx);
    }
  }

  const maxClusterPercent = (maxClusterCount / creationDates.length) * 100;
  const clusterStartDate = new Date(minDate + maxBinIndex * windowMs).toISOString().slice(0, 10);
  const clusterEndDate = new Date(minDate + (maxBinIndex + 1) * windowMs).toISOString().slice(0, 10);
  const clusterWindow = `${clusterStartDate} to ${clusterEndDate}`;

  if (maxClusterPercent > 50) {
    subscore -= 0.6;
    signals.push({
      signal: "Strong account creation clustering",
      value: `${maxClusterPercent.toFixed(1)}% in one 2-week window`,
      severity: "high",
      detail: `Over half of sampled accounts created ${clusterWindow}. Indicates batch account creation.`,
      category: "clustering",
    });
  } else if (maxClusterPercent > 30) {
    subscore -= 0.35;
    signals.push({
      signal: "Account creation clustering detected",
      value: `${maxClusterPercent.toFixed(1)}% in one 2-week window`,
      severity: "medium",
      detail: `Significant cluster of accounts created ${clusterWindow}.`,
      category: "clustering",
    });
  } else {
    signals.push({
      signal: "Account creation dates distributed",
      value: `Max cluster: ${maxClusterPercent.toFixed(1)}%`,
      severity: "ok",
      detail: "No suspicious clustering of account creation dates.",
      category: "clustering",
    });
  }

  subscore = Math.max(0, Math.min(1, subscore));
  return { maxClusterPercent: Math.round(maxClusterPercent * 10) / 10, clusterWindow, subscore, signals };
}
