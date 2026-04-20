// RealStars - Background Service Worker
// Comprehensive analysis engine for detecting fake GitHub stars.
// Handles GitHub API calls to avoid CORS issues in content scripts.
// Without authentication: 60 req/hr. With token: 5,000 req/hr.

// =============================================================================
// CONSTANTS & STATE
// =============================================================================

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MIN_STARS_THRESHOLD = 10;
const SMALL_REPO_THRESHOLD = 50;

const cache = new Map();

// API budget tracking
let apiCallsRemaining = 60; // Conservative default (unauthenticated)
let apiResetTime = 0;

// Known farms blocklist (community-populated via updates)
let knownFarmsBlocklist = [];

// Attempt to load blocklist from extension storage on startup
try {
  chrome.storage.local.get("knownFarmsBlocklist", (result) => {
    if (result.knownFarmsBlocklist && Array.isArray(result.knownFarmsBlocklist)) {
      knownFarmsBlocklist = result.knownFarmsBlocklist;
    }
  });
} catch (_) {
  // Extension storage not available in some contexts
}

// Module weights for composite scoring
const MODULE_WEIGHTS = {
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

// API cost per module (approximate GitHub API calls)
const MODULE_COSTS = {
  repoMetrics: 1,
  community: 2,
  starTiming: 4,
  stargazerPages: 5,
  individualProfiles: 60,
  overlap: 8,
  releases: 1,
  crossPlatform: 0, // External APIs, no GitHub cost
};

// =============================================================================
// CACHE UTILITIES
// =============================================================================

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// =============================================================================
// GITHUB FETCH WITH RATE LIMIT TRACKING
// =============================================================================

async function githubFetch(url, token, options = {}) {
  const headers = {
    Accept: options.accept || "application/vnd.github+json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const resp = await fetch(url, { headers });

  // Track rate limit from response headers
  const remaining = resp.headers.get("x-ratelimit-remaining");
  const reset = resp.headers.get("x-ratelimit-reset");
  if (remaining !== null) {
    apiCallsRemaining = parseInt(remaining, 10);
  }
  if (reset !== null) {
    apiResetTime = parseInt(reset, 10);
  }

  if (!resp.ok) {
    if (remaining === "0" || resp.status === 403) {
      throw new Error(`RATE_LIMITED:${reset || 0}`);
    }
    throw new Error(`GitHub API ${resp.status}: ${resp.statusText}`);
  }

  return resp.json();
}

// =============================================================================
// MODULE 1: REPO METRICS & RATIOS
// Weight: 0.12
// =============================================================================

async function fetchRepoInfo(owner, repo, token) {
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
    watchers: data.subscribers_count, // "subscribers" is the real watcher count
    issues: data.open_issues_count,
    language: data.language,
    topics: data.topics || [],
    createdAt: data.created_at,
    description: data.description,
    defaultBranch: data.default_branch,
    fullName: data.full_name,
  };
  setCache(key, result);
  return result;
}

function analyzeRepoMetrics(repoInfo) {
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

// =============================================================================
// MODULE 2: COMMUNITY ENGAGEMENT
// Weight: 0.08
// =============================================================================

async function analyzeCommunity(owner, repo, token, repoInfo) {
  const signals = [];
  let subscore = 1.0;

  const stars = repoInfo.stars;
  const issueCount = repoInfo.issues; // Already have open_issues from repo info

  // Fetch contributor count (1 API call)
  let contributorCount = 0;
  try {
    const contributors = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/contributors?per_page=1&anon=true`,
      token
    );
    // The response is an array; we need the total from Link header, but we get at least 1 page
    // For a quick estimate, we can fetch per_page=1 and check if there are more
    // Alternatively, use the array length of a larger page
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

// =============================================================================
// MODULE 3: STAR TIMING ANALYSIS
// Weight: 0.15
// =============================================================================

async function analyzeStarTiming(owner, repo, token, starCount) {
  const key = `startiming:${owner}/${repo}`;
  const cached = getCached(key);
  if (cached) return cached;

  const signals = [];
  let subscore = 1.0;

  const perPage = 30;
  const totalPages = Math.ceil(starCount / perPage);

  // Sample 3-4 pages spread across the stargazer list
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
      // Skip failed pages
    }
  }

  if (allTimestamps.length < 5) {
    const result = { bursts: [], uniformScore: 0, oddHoursPercent: 0, subscore: 0.5, signals: [] };
    setCache(key, result);
    return result;
  }

  allTimestamps.sort((a, b) => a - b);

  // --- Burst detection ---
  // Group stars by day and detect days with rate > 10x median daily rate
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
  // Bots often star at regular intervals; measure stddev of time gaps
  const gaps = [];
  for (let i = 1; i < allTimestamps.length; i++) {
    gaps.push(allTimestamps[i] - allTimestamps[i - 1]);
  }

  let uniformScore = 0;
  if (gaps.length > 2) {
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const variance = gaps.reduce((sum, g) => sum + Math.pow(g - meanGap, 2), 0) / gaps.length;
    const stddev = Math.sqrt(variance);
    // Coefficient of variation (CV): stddev / mean
    // Organic: high CV (irregular). Bots: low CV (regular spacing)
    const cv = meanGap > 0 ? stddev / meanGap : 0;
    // CV below 0.3 with many samples = suspiciously uniform
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
  // Stars between 1am-5am UTC may indicate bot farms in certain timezones
  let oddHoursCount = 0;
  for (const ts of allTimestamps) {
    const hour = new Date(ts).getUTCHours();
    if (hour >= 1 && hour <= 5) oddHoursCount++;
  }
  const oddHoursPercent = (oddHoursCount / allTimestamps.length) * 100;

  // Expected: ~16.7% (4 out of 24 hours). Above 40% is suspicious.
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

// =============================================================================
// MODULE 4: STARGAZER PROFILE QUALITY
// Weight: 0.15
// =============================================================================

function hasDefaultAvatar(avatarUrl) {
  if (!avatarUrl) return true;
  // GitHub auto-generated identicons: /u/{id}?v=4 with no user-set sizing
  return /\/u\/\d+\?/.test(avatarUrl) && !avatarUrl.includes("&s=");
}

async function sampleStargazerProfiles(owner, repo, token, sampleSize, starCount) {
  const key = `profiles:${owner}/${repo}:${sampleSize}`;
  const cached = getCached(key);
  if (cached) return cached;

  const perPage = 30;
  const totalPages = Math.ceil(starCount / perPage);

  // Pick pages spread across the stargazer list
  const pagesToFetch = [];
  if (totalPages <= 5) {
    for (let i = 1; i <= totalPages; i++) pagesToFetch.push(i);
  } else {
    const step = Math.max(1, Math.floor(totalPages / 5));
    pagesToFetch.push(1, step, step * 2, step * 3, totalPages);
  }

  let allUsers = [];
  for (const page of pagesToFetch) {
    if (allUsers.length >= sampleSize) break;
    try {
      const users = await githubFetch(
        `https://api.github.com/repos/${owner}/${repo}/stargazers?per_page=${perPage}&page=${page}`,
        token
      );
      if (Array.isArray(users)) {
        allUsers = allUsers.concat(users);
      }
    } catch (e) {
      if (e.message.startsWith("RATE_LIMITED")) throw e;
    }
  }

  // Deduplicate and limit
  const seen = new Set();
  const uniqueUsers = allUsers.filter((u) => {
    if (!u || !u.login || seen.has(u.login)) return false;
    seen.add(u.login);
    return true;
  });
  const sample = uniqueUsers.slice(0, sampleSize);

  // Fetch detailed profiles in batches
  const profiles = [];
  const batchSize = 10;
  for (let i = 0; i < sample.length; i += batchSize) {
    const batch = sample.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (u) => {
        try {
          return await githubFetch(
            `https://api.github.com/users/${u.login}`,
            token
          );
        } catch {
          return null;
        }
      })
    );
    profiles.push(...results.filter(Boolean));
  }

  setCache(key, profiles);
  return profiles;
}

function analyzeProfileQuality(profiles) {
  const signals = [];
  let subscore = 1.0;

  if (!profiles || profiles.length === 0) {
    return {
      sampleSize: 0,
      zeroReposPercent: 0,
      zeroFollowersPercent: 0,
      zeroActivityPercent: 0,
      ghostPercent: 0,
      defaultAvatarPercent: 0,
      subscore: 0.5,
      signals: [],
    };
  }

  const total = profiles.length;
  let zeroRepos = 0;
  let zeroFollowers = 0;
  let zeroActivity = 0; // No repos, no gists, no following
  let ghosts = 0; // zero repos + zero followers + no bio + default avatar
  let defaultAvatars = 0;

  for (const p of profiles) {
    const repos = p.public_repos || 0;
    const followers = p.followers || 0;
    const following = p.following || 0;
    const gists = p.public_gists || 0;
    const hasBio = !!(p.bio && p.bio.trim());
    const isDefaultAvatar = hasDefaultAvatar(p.avatar_url);

    if (repos === 0) zeroRepos++;
    if (followers === 0) zeroFollowers++;
    if (repos === 0 && gists === 0 && following === 0) zeroActivity++;
    if (isDefaultAvatar) defaultAvatars++;
    if (repos === 0 && followers === 0 && !hasBio && isDefaultAvatar) ghosts++;
  }

  const zeroReposPercent = (zeroRepos / total) * 100;
  const zeroFollowersPercent = (zeroFollowers / total) * 100;
  const zeroActivityPercent = (zeroActivity / total) * 100;
  const ghostPercent = (ghosts / total) * 100;
  const defaultAvatarPercent = (defaultAvatars / total) * 100;

  // Zero repos (organic 2-6%, fake 32-81%)
  if (zeroReposPercent > 50) {
    subscore -= 0.35;
    signals.push({
      signal: "High % stargazers with 0 repos",
      value: `${zeroReposPercent.toFixed(1)}%`,
      severity: "high",
      detail: "Organic: 2-6%. Manipulated repos: 32-81%.",
      category: "profiles",
    });
  } else if (zeroReposPercent > 20) {
    subscore -= 0.15;
    signals.push({
      signal: "Elevated % stargazers with 0 repos",
      value: `${zeroReposPercent.toFixed(1)}%`,
      severity: "medium",
      detail: "Above organic baseline of 2-6%.",
      category: "profiles",
    });
  } else {
    signals.push({
      signal: "Stargazers with repos",
      value: `${zeroReposPercent.toFixed(1)}% have 0 repos`,
      severity: "ok",
      detail: "Within organic range.",
      category: "profiles",
    });
  }

  // Zero followers (organic 5-12%, fake 52-81%)
  if (zeroFollowersPercent > 40) {
    subscore -= 0.25;
    signals.push({
      signal: "High % stargazers with 0 followers",
      value: `${zeroFollowersPercent.toFixed(1)}%`,
      severity: "high",
      detail: "Organic: 5-12%. Manipulated: 52-81%.",
      category: "profiles",
    });
  } else if (zeroFollowersPercent > 15) {
    subscore -= 0.1;
    signals.push({
      signal: "Elevated % stargazers with 0 followers",
      value: `${zeroFollowersPercent.toFixed(1)}%`,
      severity: "medium",
      detail: "Above organic baseline of 5-12%.",
      category: "profiles",
    });
  } else {
    signals.push({
      signal: "Follower distribution normal",
      value: `${zeroFollowersPercent.toFixed(1)}% have 0 followers`,
      severity: "ok",
      detail: "Within organic range.",
      category: "profiles",
    });
  }

  // Zero activity (no repos, no gists, no following - pure star bots)
  if (zeroActivityPercent > 40) {
    subscore -= 0.25;
    signals.push({
      signal: "High % zero-activity accounts",
      value: `${zeroActivityPercent.toFixed(1)}%`,
      severity: "high",
      detail: "Accounts with no repos, no gists, no following. Exist only to star.",
      category: "profiles",
    });
  } else if (zeroActivityPercent > 15) {
    subscore -= 0.1;
    signals.push({
      signal: "Elevated % zero-activity accounts",
      value: `${zeroActivityPercent.toFixed(1)}%`,
      severity: "medium",
      detail: "More star-only accounts than typical organic repos.",
      category: "profiles",
    });
  } else {
    signals.push({
      signal: "Active stargazer profiles",
      value: `${zeroActivityPercent.toFixed(1)}% zero-activity`,
      severity: "ok",
      detail: "Low percentage of accounts that only star.",
      category: "profiles",
    });
  }

  // Ghost accounts (organic ~1%, fake 19-28%)
  if (ghostPercent > 15) {
    subscore -= 0.25;
    signals.push({
      signal: "High % ghost accounts",
      value: `${ghostPercent.toFixed(1)}%`,
      severity: "high",
      detail: "No repos, no followers, no bio, default avatar. Organic: ~1%.",
      category: "profiles",
    });
  } else if (ghostPercent > 5) {
    subscore -= 0.1;
    signals.push({
      signal: "Elevated % ghost accounts",
      value: `${ghostPercent.toFixed(1)}%`,
      severity: "medium",
      detail: "Above organic baseline of ~1%.",
      category: "profiles",
    });
  } else {
    signals.push({
      signal: "Ghost accounts low",
      value: `${ghostPercent.toFixed(1)}%`,
      severity: "ok",
      detail: "Within organic range.",
      category: "profiles",
    });
  }

  // Default avatars
  if (defaultAvatarPercent > 50) {
    subscore -= 0.2;
    signals.push({
      signal: "High % default avatars",
      value: `${defaultAvatarPercent.toFixed(1)}%`,
      severity: "high",
      detail: "Most stargazers never personalized their profile.",
      category: "profiles",
    });
  } else if (defaultAvatarPercent > 25) {
    subscore -= 0.08;
    signals.push({
      signal: "Elevated % default avatars",
      value: `${defaultAvatarPercent.toFixed(1)}%`,
      severity: "medium",
      detail: "Above typical rates for organic repos.",
      category: "profiles",
    });
  } else {
    signals.push({
      signal: "Custom avatars prevalent",
      value: `${defaultAvatarPercent.toFixed(1)}% default`,
      severity: "ok",
      detail: "Most stargazers have custom profile pictures.",
      category: "profiles",
    });
  }

  subscore = Math.max(0, Math.min(1, subscore));
  return {
    sampleSize: total,
    zeroReposPercent: Math.round(zeroReposPercent * 10) / 10,
    zeroFollowersPercent: Math.round(zeroFollowersPercent * 10) / 10,
    zeroActivityPercent: Math.round(zeroActivityPercent * 10) / 10,
    ghostPercent: Math.round(ghostPercent * 10) / 10,
    defaultAvatarPercent: Math.round(defaultAvatarPercent * 10) / 10,
    subscore,
    signals,
  };
}

// =============================================================================
// MODULE 5: ACCOUNT CREATION DATE CLUSTERING
// Weight: 0.10
// =============================================================================

function analyzeCreationClustering(profiles) {
  const signals = [];
  let subscore = 1.0;

  if (!profiles || profiles.length < 5) {
    return { maxClusterPercent: 0, clusterWindow: null, subscore: 0.5, signals: [] };
  }

  // Extract creation dates and bin into 2-week windows
  const creationDates = profiles
    .filter((p) => p.created_at)
    .map((p) => new Date(p.created_at).getTime());

  if (creationDates.length < 5) {
    return { maxClusterPercent: 0, clusterWindow: null, subscore: 0.5, signals: [] };
  }

  // 2-week window = 14 days in milliseconds
  const windowMs = 14 * 24 * 60 * 60 * 1000;

  // Find the earliest date and create bins
  const minDate = Math.min(...creationDates);
  const maxDate = Math.max(...creationDates);
  const bins = {};

  for (const ts of creationDates) {
    const binIndex = Math.floor((ts - minDate) / windowMs);
    bins[binIndex] = (bins[binIndex] || 0) + 1;
  }

  // Find the largest cluster
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

  // > 30% in any single 2-week window is suspicious
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

// =============================================================================
// MODULE 6: USERNAME PATTERN DETECTION
// Weight: 0.08
// =============================================================================

function calculateShannonEntropy(str) {
  if (!str || str.length === 0) return 0;
  const freq = {};
  for (const ch of str) {
    freq[ch] = (freq[ch] || 0) + 1;
  }
  let entropy = 0;
  const len = str.length;
  for (const count of Object.values(freq)) {
    const p = count / len;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

function looksAutoGenerated(username) {
  // Pattern 1: Sequential numbers at the end (user12345, dev98765)
  if (/^[a-z]{2,8}\d{4,}$/i.test(username)) return true;

  // Pattern 2: Random consonant clusters (no vowels in long segments)
  const consonantRuns = username.match(/[bcdfghjklmnpqrstvwxyz]{5,}/gi);
  if (consonantRuns && consonantRuns.length > 0) return true;

  // Pattern 3: Alternating letter-number pattern (a1b2c3d4)
  if (/^([a-z]\d){3,}$/i.test(username)) return true;

  // Pattern 4: Very high entropy for short usernames (random strings)
  const entropy = calculateShannonEntropy(username);
  if (username.length <= 10 && entropy > 3.5) return true;
  if (username.length > 10 && entropy > 4.0) return true;

  // Pattern 5: Username is mostly hex characters
  const hexChars = (username.match(/[0-9a-f]/gi) || []).length;
  if (hexChars / username.length > 0.8 && username.length > 8) return true;

  // Pattern 6: Prefix + UUID-like pattern
  if (/^[a-z]+-[a-f0-9]{6,}$/i.test(username)) return true;

  return false;
}

function analyzeUsernamePatterns(profiles) {
  const signals = [];
  let subscore = 1.0;

  if (!profiles || profiles.length < 5) {
    return { suspiciousPercent: 0, avgEntropy: 0, subscore: 0.5, signals: [] };
  }

  const usernames = profiles.map((p) => p.login).filter(Boolean);
  if (usernames.length === 0) {
    return { suspiciousPercent: 0, avgEntropy: 0, subscore: 0.5, signals: [] };
  }

  let suspiciousCount = 0;
  let totalEntropy = 0;

  for (const name of usernames) {
    totalEntropy += calculateShannonEntropy(name);
    if (looksAutoGenerated(name)) {
      suspiciousCount++;
    }
  }

  const suspiciousPercent = (suspiciousCount / usernames.length) * 100;
  const avgEntropy = totalEntropy / usernames.length;

  if (suspiciousPercent > 40) {
    subscore -= 0.5;
    signals.push({
      signal: "High % auto-generated usernames",
      value: `${suspiciousPercent.toFixed(1)}%`,
      severity: "high",
      detail: "Many usernames match bot-generation patterns (random strings, sequential numbers).",
      category: "usernames",
    });
  } else if (suspiciousPercent > 20) {
    subscore -= 0.25;
    signals.push({
      signal: "Elevated % suspicious usernames",
      value: `${suspiciousPercent.toFixed(1)}%`,
      severity: "medium",
      detail: "Some usernames appear auto-generated.",
      category: "usernames",
    });
  } else {
    signals.push({
      signal: "Username patterns normal",
      value: `${suspiciousPercent.toFixed(1)}% suspicious`,
      severity: "ok",
      detail: "Most usernames appear human-chosen.",
      category: "usernames",
    });
  }

  // Average entropy signal (informational)
  if (avgEntropy > 3.8) {
    signals.push({
      signal: "High average username entropy",
      value: avgEntropy.toFixed(2),
      severity: "medium",
      detail: "Higher entropy suggests randomly generated usernames. Typical human: 2.5-3.5.",
      category: "usernames",
    });
  }

  subscore = Math.max(0, Math.min(1, subscore));
  return {
    suspiciousPercent: Math.round(suspiciousPercent * 10) / 10,
    avgEntropy: Math.round(avgEntropy * 100) / 100,
    subscore,
    signals,
  };
}

// =============================================================================
// MODULE 7: STARGAZER OVERLAP ANALYSIS
// Weight: 0.12
// =============================================================================

async function analyzeStargazerOverlap(profiles, token, targetRepo) {
  const signals = [];
  let subscore = 1.0;

  if (!profiles || profiles.length < 5) {
    return { checked: false, avgJaccard: 0, commonRepos: [], subscore: 0.5, signals: [] };
  }

  // Select 5-8 stargazers for overlap analysis
  const sampleSize = Math.min(8, profiles.length);
  // Pick evenly spaced profiles from the list
  const step = Math.max(1, Math.floor(profiles.length / sampleSize));
  const selectedProfiles = [];
  for (let i = 0; i < profiles.length && selectedProfiles.length < sampleSize; i += step) {
    selectedProfiles.push(profiles[i]);
  }

  // Fetch recently starred repos for each selected user
  const starredSets = [];
  for (const profile of selectedProfiles) {
    try {
      const starred = await githubFetch(
        `https://api.github.com/users/${profile.login}/starred?per_page=100&sort=created`,
        token
      );
      if (Array.isArray(starred)) {
        // Store repo full names, excluding the target repo itself
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

  // Calculate pairwise Jaccard similarity
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

  // Find commonly starred repos (appearing in >50% of sampled users)
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

  // Score: high Jaccard similarity = star farm fingerprint
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

// =============================================================================
// MODULE 8: CROSS-PLATFORM CORRELATION
// Weight: 0.05
// =============================================================================

async function analyzeCrossPlatform(repoInfo, owner, repo, token) {
  const signals = [];
  let subscore = 0.5; // Neutral default

  const language = (repoInfo.language || "").toLowerCase();
  const topics = (repoInfo.topics || []).map((t) => t.toLowerCase());

  // Determine if this is likely a published package
  let packageManager = null;
  let packageName = null;

  // Check for npm (JavaScript/TypeScript)
  if (
    language === "javascript" ||
    language === "typescript" ||
    topics.includes("npm") ||
    topics.includes("node") ||
    topics.includes("nodejs")
  ) {
    packageManager = "npm";
    packageName = repo; // Default assumption: package name = repo name
  }

  // Check for PyPI (Python)
  if (
    language === "python" ||
    topics.includes("pypi") ||
    topics.includes("pip")
  ) {
    packageManager = "pypi";
    packageName = repo;
  }

  // If not identifiable as a package, try to detect from repo contents
  if (!packageManager) {
    try {
      // Check for package.json
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
      // Check for setup.py or pyproject.toml
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
    // Not a detectable package — return neutral score
    signals.push({
      signal: "Package manager not detected",
      value: "N/A",
      severity: "ok",
      detail: "Could not identify package registry. Module skipped.",
      category: "cross-platform",
    });
    return { manager: null, downloads: null, ratio: null, subscore: 0.5, signals };
  }

  // Fetch download stats from external APIs (no GitHub rate limit cost)
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

  // Compare downloads vs stars
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

// =============================================================================
// MODULE 9: GEOGRAPHIC CLUSTERING
// Weight: 0.05
// =============================================================================

function analyzeGeographicClustering(profiles) {
  const signals = [];
  let subscore = 1.0;

  if (!profiles || profiles.length < 5) {
    return { topLocation: null, topPercent: 0, subscore: 0.5, signals: [] };
  }

  // Extract location field from profiles
  const locations = profiles
    .map((p) => p.location)
    .filter((loc) => loc && loc.trim().length > 0)
    .map((loc) => loc.trim().toLowerCase());

  if (locations.length < 3) {
    signals.push({
      signal: "Insufficient location data",
      value: `${locations.length} profiles with location`,
      severity: "ok",
      detail: "Not enough location data to detect geographic clustering.",
      category: "geographic",
    });
    return { topLocation: null, topPercent: 0, subscore: 0.5, signals };
  }

  // Normalize locations to approximate country/region
  const normalized = locations.map((loc) => {
    // Common normalizations
    if (/china|beijing|shanghai|shenzhen|guangzhou|hangzhou|chengdu/i.test(loc)) return "china";
    if (/india|mumbai|bangalore|bengaluru|delhi|hyderabad|chennai|pune/i.test(loc)) return "india";
    if (/russia|moscow|saint petersburg|novosibirsk/i.test(loc)) return "russia";
    if (/brazil|são paulo|rio|brasilia/i.test(loc)) return "brazil";
    if (/usa|united states|california|new york|san francisco|seattle|texas/i.test(loc)) return "usa";
    if (/uk|united kingdom|london|england/i.test(loc)) return "uk";
    if (/germany|berlin|munich|hamburg/i.test(loc)) return "germany";
    if (/france|paris|lyon/i.test(loc)) return "france";
    if (/japan|tokyo|osaka/i.test(loc)) return "japan";
    if (/korea|seoul/i.test(loc)) return "south korea";
    if (/vietnam|hanoi|ho chi minh/i.test(loc)) return "vietnam";
    if (/indonesia|jakarta/i.test(loc)) return "indonesia";
    if (/pakistan|karachi|lahore|islamabad/i.test(loc)) return "pakistan";
    if (/bangladesh|dhaka/i.test(loc)) return "bangladesh";
    if (/nigeria|lagos/i.test(loc)) return "nigeria";
    if (/ukraine|kyiv|kiev/i.test(loc)) return "ukraine";
    if (/turkey|istanbul|ankara/i.test(loc)) return "turkey";
    if (/iran|tehran/i.test(loc)) return "iran";
    if (/canada|toronto|vancouver|montreal/i.test(loc)) return "canada";
    if (/australia|sydney|melbourne/i.test(loc)) return "australia";
    return loc; // Keep as-is if not matched
  });

  // Count occurrences of each location
  const locationCounts = {};
  for (const loc of normalized) {
    locationCounts[loc] = (locationCounts[loc] || 0) + 1;
  }

  // Find the top location
  let topLocation = null;
  let topCount = 0;
  for (const [loc, count] of Object.entries(locationCounts)) {
    if (count > topCount) {
      topCount = count;
      topLocation = loc;
    }
  }

  const topPercent = (topCount / locations.length) * 100;

  if (topPercent > 70) {
    subscore -= 0.5;
    signals.push({
      signal: "Extreme geographic concentration",
      value: `${topPercent.toFixed(1)}% from "${topLocation}"`,
      severity: "high",
      detail: "Over 70% of profiles with a location share the same country/region.",
      category: "geographic",
    });
  } else if (topPercent > 60) {
    subscore -= 0.3;
    signals.push({
      signal: "High geographic concentration",
      value: `${topPercent.toFixed(1)}% from "${topLocation}"`,
      severity: "medium",
      detail: "Over 60% from one region suggests a potential star farm cluster.",
      category: "geographic",
    });
  } else {
    signals.push({
      signal: "Geographic diversity",
      value: `Top: ${topPercent.toFixed(1)}% "${topLocation}"`,
      severity: "ok",
      detail: "Stargazers are geographically distributed — organic signal.",
      category: "geographic",
    });
  }

  subscore = Math.max(0, Math.min(1, subscore));
  return {
    topLocation,
    topPercent: Math.round(topPercent * 10) / 10,
    subscore,
    signals,
  };
}

// =============================================================================
// MODULE 10: STAR VELOCITY VS RELEASES
// Weight: 0.05
// =============================================================================

async function analyzeVelocityVsReleases(owner, repo, token, starTimingBursts) {
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

  // Fetch releases
  let releases = [];
  try {
    releases = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`,
      token
    );
    if (!Array.isArray(releases)) releases = [];
  } catch (e) {
    if (e.message.startsWith("RATE_LIMITED")) throw e;
    // If releases fetch fails, we cannot correlate
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
    // No releases — bursts without any releases are suspicious
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

  // Extract release dates
  const releaseDates = releases
    .map((r) => new Date(r.published_at || r.created_at).getTime())
    .filter((t) => !isNaN(t));

  // Check if each burst correlates with a release (within 7 days)
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  let unmatchedBursts = 0;

  for (const burst of starTimingBursts) {
    const burstDate = new Date(burst.date).getTime();
    const correlatesWithRelease = releaseDates.some(
      (releaseDate) => Math.abs(burstDate - releaseDate) <= sevenDaysMs
    );
    if (!correlatesWithRelease) {
      unmatchedBursts++;
    }
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

// =============================================================================
// MODULE 11: KNOWN FARM BLOCKLIST
// Weight: 0.05
// =============================================================================

function analyzeBlocklist(profiles) {
  const signals = [];
  let subscore = 1.0;

  if (!profiles || profiles.length === 0) {
    return { matchCount: 0, matched: [], subscore: 0.5, signals: [] };
  }

  const matched = [];
  for (const p of profiles) {
    const login = (p.login || "").toLowerCase();

    // Check against known farms blocklist
    if (knownFarmsBlocklist.includes(login)) {
      matched.push(login);
      continue;
    }

    // Also flag accounts matching common bot patterns
    // Pattern: generated names like "user-XXXX", prefixed UUIDs, etc.
    if (/^(user|dev|test|bot|star|fake|dummy|temp)[-_]?\d{3,}$/i.test(login)) {
      matched.push(login);
      continue;
    }

    // Pattern: GitHub's auto-generated names when merging accounts
    if (/^ghost$/i.test(login)) {
      matched.push(login);
      continue;
    }
  }

  const matchCount = matched.length;
  const matchPercent = (matchCount / profiles.length) * 100;

  if (matchPercent > 10) {
    subscore -= 0.6;
    signals.push({
      signal: "Multiple blocklist/bot-pattern matches",
      value: `${matchCount} accounts (${matchPercent.toFixed(1)}%)`,
      severity: "high",
      detail: `Accounts matched: ${matched.slice(0, 5).join(", ")}${matched.length > 5 ? "..." : ""}`,
      category: "blocklist",
    });
  } else if (matchCount > 0) {
    subscore -= 0.2;
    signals.push({
      signal: "Some blocklist/bot-pattern matches",
      value: `${matchCount} account(s)`,
      severity: "medium",
      detail: `Matched: ${matched.join(", ")}`,
      category: "blocklist",
    });
  } else {
    signals.push({
      signal: "No blocklist matches",
      value: "0",
      severity: "ok",
      detail: "No sampled accounts match known bot patterns or blocklist entries.",
      category: "blocklist",
    });
  }

  subscore = Math.max(0, Math.min(1, subscore));
  return { matchCount, matched, subscore, signals };
}

// =============================================================================
// MODULE 12: WEIGHTED COMPOSITE SCORE
// =============================================================================

function computeCompositeScore(subscores) {
  let totalWeight = 0;
  let weightedSum = 0;

  for (const [module, weight] of Object.entries(MODULE_WEIGHTS)) {
    if (subscores[module] !== undefined && subscores[module] !== null) {
      weightedSum += weight * subscores[module];
      totalWeight += weight;
    }
  }

  // Normalize if not all modules ran (weights don't sum to 1.0)
  const rawScore = totalWeight > 0 ? (weightedSum / totalWeight) * 100 : 50;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  let grade, label;
  if (score >= 80) {
    grade = "A";
    label = "Likely Organic";
  } else if (score >= 60) {
    grade = "B";
    label = "Mostly Organic";
  } else if (score >= 40) {
    grade = "C";
    label = "Some Suspicious Signals";
  } else if (score >= 20) {
    grade = "D";
    label = "Likely Manipulated";
  } else {
    grade = "F";
    label = "Highly Suspicious";
  }

  return { score, grade, label };
}

// =============================================================================
// MODULE 13: HISTORICAL TRACKING
// =============================================================================

async function getHistorical(owner, repo) {
  try {
    const key = `history:${owner}/${repo}`;
    const result = await chrome.storage.local.get(key);
    return result[key] || null;
  } catch {
    return null;
  }
}

async function saveHistorical(owner, repo, score, grade, stars) {
  try {
    const key = `history:${owner}/${repo}`;
    const entry = {
      score,
      grade,
      date: new Date().toISOString(),
      stars,
    };
    await chrome.storage.local.set({ [key]: entry });
  } catch {
    // Storage not available
  }
}

// =============================================================================
// API BUDGET MANAGEMENT
// =============================================================================

function determineAnalysisDepth(hasToken, starCount) {
  // Without token: 60/hr budget — only run cheap modules
  if (!hasToken) {
    return "quick";
  }

  // With token and low budget: run standard set
  if (apiCallsRemaining < 100) {
    return "standard";
  }

  // With token and adequate budget: run everything
  return "deep";
}

function getProfileSampleSize(depth, starCount) {
  switch (depth) {
    case "quick":
      return 20;
    case "standard":
      return 40;
    case "deep":
      return starCount > 10000 ? 100 : 60;
    default:
      return 20;
  }
}

// =============================================================================
// MAIN ANALYSIS ORCHESTRATOR
// =============================================================================

async function handleAnalyze(owner, repo, pageData) {
  // Check full-result cache first
  const fullCacheKey = `analysis:${owner}/${repo}`;
  const cachedResult = getCached(fullCacheKey);
  if (cachedResult) return cachedResult;

  const { githubToken } = await chrome.storage.sync.get("githubToken");
  const token = githubToken || null;
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
    };
    // Supplement incomplete page data from API
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

  // --- MIN_STARS check ---
  if (repoInfo.stars < MIN_STARS_THRESHOLD) {
    return { hide: true };
  }

  // --- Small repo: only ratio + basic profile signals ---
  if (repoInfo.stars < SMALL_REPO_THRESHOLD) {
    const metricsResult = analyzeRepoMetrics(repoInfo);
    const allSignals = [...metricsResult.signals];
    const subscores = { repoMetrics: metricsResult.subscore };
    const { score, grade, label } = computeCompositeScore(subscores);

    const result = {
      repoInfo: {
        stars: repoInfo.stars,
        forks: repoInfo.forks,
        watchers: repoInfo.watchers,
        issues: repoInfo.issues,
        language: repoInfo.language,
        topics: repoInfo.topics,
        createdAt: repoInfo.createdAt,
      },
      community: null,
      starTiming: null,
      profiles: null,
      creationClustering: null,
      usernamePatterns: null,
      overlap: null,
      crossPlatform: null,
      geographic: null,
      velocity: null,
      blocklist: null,
      trust: {
        score,
        grade,
        label,
        signals: allSignals,
        weights: MODULE_WEIGHTS,
        subscores,
      },
      historical: null,
      hide: false,
      smallRepo: true,
      analysisDepth: "quick",
    };

    setCache(fullCacheKey, result);
    return result;
  }

  // --- Determine analysis depth based on budget ---
  const analysisDepth = determineAnalysisDepth(hasToken, repoInfo.stars);
  const profileSampleSize = getProfileSampleSize(analysisDepth, repoInfo.stars);

  // --- Module 1: Repo Metrics ---
  const metricsResult = analyzeRepoMetrics(repoInfo);

  // --- Fetch profiles (shared across multiple modules) ---
  let profiles = null;
  try {
    profiles = await sampleStargazerProfiles(owner, repo, token, profileSampleSize, repoInfo.stars);
  } catch (e) {
    if (e.message.startsWith("RATE_LIMITED")) {
      // Return partial result with just metrics
      const subscores = { repoMetrics: metricsResult.subscore };
      const { score, grade, label } = computeCompositeScore(subscores);
      const reset = e.message.split(":")[1];
      return {
        repoInfo: {
          stars: repoInfo.stars,
          forks: repoInfo.forks,
          watchers: repoInfo.watchers,
          issues: repoInfo.issues,
          language: repoInfo.language,
          topics: repoInfo.topics,
          createdAt: repoInfo.createdAt,
        },
        community: null,
        starTiming: null,
        profiles: null,
        creationClustering: null,
        usernamePatterns: null,
        overlap: null,
        crossPlatform: null,
        geographic: null,
        velocity: null,
        blocklist: null,
        trust: {
          score,
          grade,
          label,
          signals: metricsResult.signals,
          weights: MODULE_WEIGHTS,
          subscores,
        },
        historical: null,
        hide: false,
        smallRepo: false,
        analysisDepth: "quick",
        rateLimited: true,
        resetAt: parseInt(reset),
      };
    }
    // Continue without profiles
  }

  // --- Module 2: Community Engagement ---
  let communityResult = null;
  if (analysisDepth !== "quick") {
    try {
      communityResult = await analyzeCommunity(owner, repo, token, repoInfo);
    } catch (e) {
      if (e.message.startsWith("RATE_LIMITED")) {
        // Continue with what we have
      }
    }
  }

  // --- Module 3: Star Timing ---
  let starTimingResult = null;
  if (analysisDepth === "deep" || analysisDepth === "standard") {
    try {
      starTimingResult = await analyzeStarTiming(owner, repo, token, repoInfo.stars);
    } catch (e) {
      if (e.message.startsWith("RATE_LIMITED")) {
        // Continue
      }
    }
  }

  // --- Module 4: Profile Quality ---
  let profilesResult = null;
  if (profiles && profiles.length > 0) {
    try {
      profilesResult = analyzeProfileQuality(profiles);
    } catch {
      // Module failed, continue
    }
  }

  // --- Module 5: Creation Clustering ---
  let creationClusteringResult = null;
  if (profiles && profiles.length > 0) {
    try {
      creationClusteringResult = analyzeCreationClustering(profiles);
    } catch {
      // Module failed, continue
    }
  }

  // --- Module 6: Username Patterns ---
  let usernameResult = null;
  if (profiles && profiles.length > 0) {
    try {
      usernameResult = analyzeUsernamePatterns(profiles);
    } catch {
      // Module failed, continue
    }
  }

  // --- Module 7: Stargazer Overlap ---
  let overlapResult = null;
  if (analysisDepth === "deep" && profiles && profiles.length >= 5) {
    try {
      overlapResult = await analyzeStargazerOverlap(
        profiles,
        token,
        `${owner}/${repo}`
      );
    } catch (e) {
      if (!e.message.startsWith("RATE_LIMITED")) {
        // Module failed, continue
      }
    }
  }

  // --- Module 8: Cross-Platform Correlation ---
  let crossPlatformResult = null;
  try {
    crossPlatformResult = await analyzeCrossPlatform(repoInfo, owner, repo, token);
  } catch {
    // Module failed, continue
  }

  // --- Module 9: Geographic Clustering ---
  let geographicResult = null;
  if (profiles && profiles.length > 0) {
    try {
      geographicResult = analyzeGeographicClustering(profiles);
    } catch {
      // Module failed, continue
    }
  }

  // --- Module 10: Star Velocity vs Releases ---
  let velocityResult = null;
  if (analysisDepth === "deep" && starTimingResult && starTimingResult.bursts.length > 0) {
    try {
      velocityResult = await analyzeVelocityVsReleases(
        owner,
        repo,
        token,
        starTimingResult.bursts
      );
    } catch (e) {
      if (!e.message.startsWith("RATE_LIMITED")) {
        // Module failed, continue
      }
    }
  }

  // --- Module 11: Blocklist ---
  let blocklistResult = null;
  if (profiles && profiles.length > 0) {
    try {
      blocklistResult = analyzeBlocklist(profiles);
    } catch {
      // Module failed, continue
    }
  }

  // --- Module 12: Compute composite score ---
  const subscores = {
    repoMetrics: metricsResult.subscore,
  };
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

  // Flatten all signals from all modules
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

  // --- Module 13: Historical tracking ---
  let historical = null;
  try {
    const previous = await getHistorical(owner, repo);
    if (previous) {
      const trend =
        score > previous.score + 5
          ? "improving"
          : score < previous.score - 5
          ? "declining"
          : "stable";
      historical = {
        previousScore: previous.score,
        previousDate: previous.date,
        previousGrade: previous.grade,
        trend,
      };
    }
    // Save current result
    await saveHistorical(owner, repo, score, grade, repoInfo.stars);
  } catch {
    // Historical tracking failed, non-critical
  }

  // --- Assemble final result ---
  const result = {
    repoInfo: {
      stars: repoInfo.stars,
      forks: repoInfo.forks,
      watchers: repoInfo.watchers,
      issues: repoInfo.issues,
      language: repoInfo.language,
      topics: repoInfo.topics,
      createdAt: repoInfo.createdAt,
    },
    community: communityResult
      ? {
          issueCount: communityResult.issueCount,
          contributorCount: communityResult.contributorCount,
          issueStarRatio: communityResult.issueStarRatio,
          contributorStarRatio: communityResult.contributorStarRatio,
          subscore: communityResult.subscore,
          signals: communityResult.signals,
        }
      : null,
    starTiming: starTimingResult
      ? {
          bursts: starTimingResult.bursts,
          uniformScore: starTimingResult.uniformScore,
          oddHoursPercent: starTimingResult.oddHoursPercent,
          subscore: starTimingResult.subscore,
          signals: starTimingResult.signals,
        }
      : null,
    profiles: profilesResult
      ? {
          sampleSize: profilesResult.sampleSize,
          zeroReposPercent: profilesResult.zeroReposPercent,
          zeroFollowersPercent: profilesResult.zeroFollowersPercent,
          zeroActivityPercent: profilesResult.zeroActivityPercent,
          ghostPercent: profilesResult.ghostPercent,
          defaultAvatarPercent: profilesResult.defaultAvatarPercent,
          subscore: profilesResult.subscore,
          signals: profilesResult.signals,
        }
      : null,
    creationClustering: creationClusteringResult
      ? {
          maxClusterPercent: creationClusteringResult.maxClusterPercent,
          clusterWindow: creationClusteringResult.clusterWindow,
          subscore: creationClusteringResult.subscore,
          signals: creationClusteringResult.signals,
        }
      : null,
    usernamePatterns: usernameResult
      ? {
          suspiciousPercent: usernameResult.suspiciousPercent,
          avgEntropy: usernameResult.avgEntropy,
          subscore: usernameResult.subscore,
          signals: usernameResult.signals,
        }
      : null,
    overlap: overlapResult
      ? {
          checked: overlapResult.checked,
          avgJaccard: overlapResult.avgJaccard,
          commonRepos: overlapResult.commonRepos,
          subscore: overlapResult.subscore,
          signals: overlapResult.signals,
        }
      : null,
    crossPlatform: crossPlatformResult
      ? {
          manager: crossPlatformResult.manager,
          downloads: crossPlatformResult.downloads,
          ratio: crossPlatformResult.ratio,
          subscore: crossPlatformResult.subscore,
          signals: crossPlatformResult.signals,
        }
      : null,
    geographic: geographicResult
      ? {
          topLocation: geographicResult.topLocation,
          topPercent: geographicResult.topPercent,
          subscore: geographicResult.subscore,
          signals: geographicResult.signals,
        }
      : null,
    velocity: velocityResult
      ? {
          unmatchedBursts: velocityResult.unmatchedBursts,
          subscore: velocityResult.subscore,
          signals: velocityResult.signals,
        }
      : null,
    blocklist: blocklistResult
      ? {
          matchCount: blocklistResult.matchCount,
          matched: blocklistResult.matched,
          subscore: blocklistResult.subscore,
          signals: blocklistResult.signals,
        }
      : null,
    trust: {
      score,
      grade,
      label,
      signals: allSignals,
      weights: MODULE_WEIGHTS,
      subscores,
    },
    historical,
    hide: false,
    smallRepo: false,
    analysisDepth,
  };

  setCache(fullCacheKey, result);
  return result;
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
    return true; // async response
  }

  if (msg.type === "GET_TOKEN") {
    chrome.storage.sync.get("githubToken", (result) => {
      sendResponse({ token: result.githubToken || "" });
    });
    return true;
  }

  if (msg.type === "SET_TOKEN") {
    chrome.storage.sync.set({ githubToken: msg.token }, () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "DELETE_TOKEN") {
    chrome.storage.sync.remove("githubToken", () => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "VALIDATE_TOKEN") {
    validateToken(msg.token)
      .then(sendResponse)
      .catch((err) => sendResponse({ valid: false, error: err.message }));
    return true;
  }

  // Fallback: always respond so the message port doesn't hang
  sendResponse({ error: "unknown_message_type" });
  return false;
});
