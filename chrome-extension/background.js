// RealStars - Background Service Worker
// Orchestrates analysis by delegating to focused signal modules.

import { MIN_STARS_THRESHOLD, SMALL_REPO_THRESHOLD, MODULE_WEIGHTS,
         determineAnalysisDepth, getProfileSampleSize } from "./modules/constants.js";
import { getCached, setCache } from "./modules/cache.js";
import { getApiCallsRemaining } from "./modules/github-api.js";
import { fetchRepoInfo, analyzeRepoMetrics } from "./modules/repo-metrics.js";
import { analyzeCommunity } from "./modules/community.js";
import { analyzeStarTiming } from "./modules/star-timing.js";
import { sampleStargazerProfiles, analyzeProfileQuality } from "./modules/profiles.js";
import { analyzeCreationClustering } from "./modules/creation-clustering.js";
import { analyzeUsernamePatterns } from "./modules/username-patterns.js";
import { analyzeStargazerOverlap } from "./modules/stargazer-overlap.js";
import { analyzeCrossPlatform } from "./modules/cross-platform.js";
import { analyzeGeographicClustering } from "./modules/geographic.js";
import { analyzeVelocityVsReleases } from "./modules/velocity.js";
import { analyzeBlocklist } from "./modules/blocklist.js";
import { computeCompositeScore } from "./modules/scoring.js";
import { getHistorical, saveHistorical } from "./modules/historical.js";

// =============================================================================
// STATE
// =============================================================================

let knownFarmsBlocklist = [];

const knownFarmsReady = loadKnownFarmsBlocklist();

function mergeKnownFarms(...sources) {
  const exactUsernames = new Set();
  const usernamePatterns = [];

  for (const source of sources) {
    if (!source) continue;

    if (Array.isArray(source)) {
      for (const username of source) {
        if (typeof username === "string" && username.trim()) {
          exactUsernames.add(username.trim().toLowerCase());
        }
      }
      continue;
    }

    if (typeof source !== "object") continue;

    const exact = Array.isArray(source.exactUsernames) ? source.exactUsernames : [];
    for (const username of exact) {
      if (typeof username === "string" && username.trim()) {
        exactUsernames.add(username.trim().toLowerCase());
      }
    }

    const patterns = Array.isArray(source.usernamePatterns) ? source.usernamePatterns : [];
    for (const pattern of patterns) {
      if (typeof pattern === "string" && pattern.trim()) {
        usernamePatterns.push(pattern.trim());
      }
    }
  }

  return { exactUsernames: [...exactUsernames], usernamePatterns };
}

async function loadKnownFarmsBlocklist() {
  let stored = null;
  let bundled = null;

  try {
    const result = await chrome.storage.local.get("knownFarmsBlocklist");
    stored = result.knownFarmsBlocklist || null;
  } catch {
    // Extension storage not available in some contexts.
  }

  try {
    const resp = await fetch(chrome.runtime.getURL("known-farms.json"));
    if (resp.ok) bundled = await resp.json();
  } catch {
    // Bundled blocklist is optional defense-in-depth data.
  }

  knownFarmsBlocklist = mergeKnownFarms(bundled, stored);
}

async function getStoredToken() {
  try {
    const local = await chrome.storage.local.get("githubToken");
    if (local.githubToken) return local.githubToken;
  } catch {
    // Fall through to legacy sync storage.
  }

  try {
    const legacy = await chrome.storage.sync.get("githubToken");
    if (legacy.githubToken) {
      try {
        await chrome.storage.local.set({ githubToken: legacy.githubToken });
        await chrome.storage.sync.remove("githubToken");
      } catch {
        // If migration fails, still use the token for this request.
      }
      return legacy.githubToken;
    }
  } catch {
    // No token available.
  }

  return "";
}

// =============================================================================
// MAIN ANALYSIS ORCHESTRATOR
// =============================================================================

async function handleAnalyze(owner, repo, pageData) {
  const token = await getStoredToken();
  const hasToken = !!token;

  // --- Fetch repo info ---
  let repoInfo;
  if (pageData && pageData.stars != null) {
    repoInfo = {
      stars: pageData.stars,
      forks: pageData.forks || 0,
      watchers: pageData.watchers || 0,
      issues: pageData.issues || 0,
      language: pageData.language || null,
      topics: pageData.topics || [],
      createdAt: pageData.createdAt || "",
      description: pageData.description || "",
      defaultBranch: pageData.defaultBranch || "main",
      fullName: `${owner}/${repo}`,
      isPrivate: !!pageData.isPrivate,
    };
    if (repoInfo.watchers == null || repoInfo.watchers === 0) {
      try {
        const apiData = await fetchRepoInfo(owner, repo, token);
        Object.assign(repoInfo, apiData);
      } catch (e) {
        if (e.message.startsWith("RATE_LIMITED")) throw e;
      }
    }
  } else {
    repoInfo = await fetchRepoInfo(owner, repo, token);
  }

  // --- Private repo check ---
  if (repoInfo.isPrivate) {
    return { hide: true, reason: "private" };
  }

  // --- MIN_STARS check ---
  if (repoInfo.stars < MIN_STARS_THRESHOLD) {
    return { hide: true };
  }

  // --- Determine analysis depth ---
  const analysisDepth = repoInfo.stars < SMALL_REPO_THRESHOLD
    ? "quick"
    : determineAnalysisDepth(hasToken, getApiCallsRemaining());

  // Cache by depth so a quick anonymous result does not mask a deeper token-backed result.
  const fullCacheKey = `analysis:${owner}/${repo}:${analysisDepth}`;
  const cachedResult = getCached(fullCacheKey);
  if (cachedResult) return cachedResult;

  // --- Small repo: only ratio signals ---
  if (repoInfo.stars < SMALL_REPO_THRESHOLD) {
    const metricsResult = analyzeRepoMetrics(repoInfo);
    const subscores = { repoMetrics: metricsResult.subscore };
    const { score, grade, label } = computeCompositeScore(subscores);

    const result = {
      repoInfo: pickRepoFields(repoInfo),
      community: null, starTiming: null, profiles: null,
      creationClustering: null, usernamePatterns: null, overlap: null,
      crossPlatform: null, geographic: null, velocity: null, blocklist: null,
      trust: { score, grade, label, signals: metricsResult.signals, weights: MODULE_WEIGHTS, subscores },
      historical: null, hide: false, smallRepo: true, analysisDepth: "quick",
    };
    setCache(fullCacheKey, result);
    return result;
  }

  const profileSampleSize = getProfileSampleSize(analysisDepth, repoInfo.stars);

  // --- Module 1: Repo Metrics ---
  const metricsResult = analyzeRepoMetrics(repoInfo);

  // --- Fetch profiles (shared across modules 4-6, 9, 11) ---
  let profiles = null;
  try {
    profiles = await sampleStargazerProfiles(owner, repo, token, profileSampleSize, repoInfo.stars);
    console.log(`[RealStars] Fetched ${profiles ? profiles.length : 0} profiles for ${owner}/${repo}`);
  } catch (e) {
    if (e.message.startsWith("RATE_LIMITED")) {
      return buildPartialResult(repoInfo, metricsResult, e);
    }
    console.warn("[RealStars] Profile fetch failed:", e.message || e);
  }

  // --- Run remaining modules, continuing on failure ---
  const communityResult = await runModule(
    () => analysisDepth !== "quick" && analyzeCommunity(owner, repo, token, repoInfo)
  );

  const starTimingResult = await runModule(
    () => (analysisDepth === "deep" || analysisDepth === "standard") &&
          analyzeStarTiming(owner, repo, token, repoInfo.stars)
  );

  const profilesResult = runSync(() => profiles && profiles.length > 0 && analyzeProfileQuality(profiles));
  const creationClusteringResult = runSync(() => profiles && profiles.length > 0 && analyzeCreationClustering(profiles));
  const usernameResult = runSync(() => profiles && profiles.length > 0 && analyzeUsernamePatterns(profiles));

  const overlapResult = await runModule(
    () => analysisDepth === "deep" && profiles && profiles.length >= 5 &&
          analyzeStargazerOverlap(profiles, token, `${owner}/${repo}`)
  );

  const crossPlatformResult = await runModule(
    () => analyzeCrossPlatform(repoInfo, owner, repo, token)
  );

  const geographicResult = runSync(() => profiles && profiles.length > 0 && analyzeGeographicClustering(profiles));

  const velocityResult = await runModule(
    () => analysisDepth === "deep" && starTimingResult && starTimingResult.bursts.length > 0 &&
          analyzeVelocityVsReleases(owner, repo, token, starTimingResult.bursts)
  );

  await knownFarmsReady;
  const blocklistResult = runSync(
    () => profiles && profiles.length > 0 && analyzeBlocklist(profiles, knownFarmsBlocklist)
  );

  // --- Composite score ---
  const subscores = { repoMetrics: metricsResult.subscore };
  if (communityResult) subscores.community = communityResult.subscore;
  if (starTimingResult) subscores.starTiming = starTimingResult.subscore;
  if (profilesResult) subscores.profiles = profilesResult.subscore;
  if (creationClusteringResult) subscores.creationClustering = creationClusteringResult.subscore;
  if (usernameResult) subscores.usernamePatterns = usernameResult.subscore;
  if (overlapResult) subscores.overlap = overlapResult.subscore;
  if (crossPlatformResult) subscores.crossPlatform = crossPlatformResult.subscore;
  if (geographicResult) subscores.geographic = geographicResult.subscore;
  if (velocityResult) subscores.velocity = velocityResult.subscore;
  if (blocklistResult) subscores.blocklist = blocklistResult.subscore;

  const { score, grade, label } = computeCompositeScore(subscores);

  const allSignals = [
    ...metricsResult.signals,
    ...(communityResult ? communityResult.signals : []),
    ...(starTimingResult ? starTimingResult.signals : []),
    ...(profilesResult ? profilesResult.signals : []),
    ...(creationClusteringResult ? creationClusteringResult.signals : []),
    ...(usernameResult ? usernameResult.signals : []),
    ...(overlapResult ? overlapResult.signals : []),
    ...(crossPlatformResult ? crossPlatformResult.signals : []),
    ...(geographicResult ? geographicResult.signals : []),
    ...(velocityResult ? velocityResult.signals : []),
    ...(blocklistResult ? blocklistResult.signals : []),
  ];

  // --- Historical tracking ---
  let historical = null;
  try {
    const previous = await getHistorical(owner, repo);
    if (previous) {
      const trend =
        score > previous.score + 5 ? "improving" :
        score < previous.score - 5 ? "declining" : "stable";
      historical = {
        previousScore: previous.score,
        previousDate: previous.date,
        previousGrade: previous.grade,
        trend,
      };
    }
    await saveHistorical(owner, repo, score, grade, repoInfo.stars);
  } catch {
    // Non-critical
  }

  // --- Assemble result ---
  const result = {
    repoInfo: pickRepoFields(repoInfo),
    community: communityResult || null,
    starTiming: starTimingResult || null,
    profiles: profilesResult || null,
    creationClustering: creationClusteringResult || null,
    usernamePatterns: usernameResult || null,
    overlap: overlapResult || null,
    crossPlatform: crossPlatformResult || null,
    geographic: geographicResult || null,
    velocity: velocityResult || null,
    blocklist: blocklistResult || null,
    trust: { score, grade, label, signals: allSignals, weights: MODULE_WEIGHTS, subscores },
    historical,
    hide: false,
    smallRepo: false,
    analysisDepth,
  };

  setCache(fullCacheKey, result);
  return result;
}

// =============================================================================
// HELPERS
// =============================================================================

function pickRepoFields(ri) {
  return {
    stars: ri.stars, forks: ri.forks, watchers: ri.watchers,
    issues: ri.issues, language: ri.language, topics: ri.topics,
    createdAt: ri.createdAt,
  };
}

async function runModule(fn) {
  try {
    const result = await fn();
    return result || null;
  } catch (e) {
    if (e.message && e.message.startsWith("RATE_LIMITED")) {
      // Swallow — continue with remaining modules
    } else {
      console.warn("[RealStars] Module error:", e.message || e);
    }
    return null;
  }
}

function runSync(fn) {
  try {
    return fn() || null;
  } catch (e) {
    console.warn("[RealStars] Sync module error:", e.message || e);
    return null;
  }
}

function buildPartialResult(repoInfo, metricsResult, err) {
  const subscores = { repoMetrics: metricsResult.subscore };
  const { score, grade, label } = computeCompositeScore(subscores);
  const reset = err.message.split(":")[1];
  return {
    repoInfo: pickRepoFields(repoInfo),
    community: null, starTiming: null, profiles: null,
    creationClustering: null, usernamePatterns: null, overlap: null,
    crossPlatform: null, geographic: null, velocity: null, blocklist: null,
    trust: { score, grade, label, signals: metricsResult.signals, weights: MODULE_WEIGHTS, subscores },
    historical: null, hide: false, smallRepo: false, analysisDepth: "quick",
    rateLimited: true, resetAt: parseInt(reset),
  };
}

// =============================================================================
// TOKEN VALIDATION
// =============================================================================

async function validateToken(token) {
  try {
    const resp = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!resp.ok) return { valid: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();

    const rateResp = await fetch("https://api.github.com/rate_limit", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
      },
    });
    const rateData = rateResp.ok ? await rateResp.json() : null;

    return {
      valid: true,
      user: data.login,
      rateLimit: rateData ? rateData.rate.limit : null,
      rateRemaining: rateData ? rateData.rate.remaining : null,
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// =============================================================================
// MESSAGE HANDLER
// =============================================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ANALYZE_REPO") {
    handleAnalyze(msg.owner, msg.repo, msg.pageData)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.type === "GET_TOKEN") {
    getStoredToken()
      .then((token) => sendResponse({ token: token || "" }))
      .catch((err) => sendResponse({ token: "", error: err.message }));
    return true;
  }

  if (msg.type === "SET_TOKEN") {
    chrome.storage.local.set({ githubToken: msg.token })
      .then(() => chrome.storage.sync.remove("githubToken"))
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "DELETE_TOKEN") {
    Promise.allSettled([
      chrome.storage.local.remove("githubToken"),
      chrome.storage.sync.remove("githubToken"),
    ])
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "VALIDATE_TOKEN") {
    validateToken(msg.token)
      .then(sendResponse)
      .catch((err) => sendResponse({ valid: false, error: err.message }));
    return true;
  }

  sendResponse({ error: "unknown_message_type" });
  return false;
});
