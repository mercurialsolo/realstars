// Shared constants, weights, and budget helpers

export const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
export const MIN_STARS_THRESHOLD = 10;
export const SMALL_REPO_THRESHOLD = 50;

export const MODULE_WEIGHTS = {
  repoMetrics: 0.12,
  community: 0.08,
  starTiming: 0.15,
  profiles: 0.15,
  creationClustering: 0.10,
  usernamePatterns: 0.08,
  overlap: 0.12,
  crossPlatform: 0.05,
  geographic: 0.05,
  velocity: 0.05,
  blocklist: 0.05,
};

export const MODULE_COSTS = {
  repoMetrics: 1,
  community: 2,
  starTiming: 4,
  stargazerPages: 5,
  individualProfiles: 60,
  overlap: 8,
  releases: 1,
  crossPlatform: 0,
};

export function determineAnalysisDepth(hasToken, apiCallsRemaining) {
  if (!hasToken) return "quick";
  if (apiCallsRemaining < 100) return "standard";
  return "deep";
}

export function getProfileSampleSize(depth, starCount) {
  switch (depth) {
    case "quick": return 20;
    case "standard": return 40;
    case "deep": return starCount > 10000 ? 100 : 60;
    default: return 20;
  }
}
