// RealStars - Background Service Worker
// Handles GitHub API calls to avoid CORS issues in content scripts
// Works without authentication for public repos (60 req/hr).
// With a token: 5,000 req/hr — optional for power users.

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour (generous cache to save API calls)
const cache = new Map();
let apiCallsThisHour = 0;
let apiResetTime = 0;

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

async function githubFetch(url, token) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const resp = await fetch(url, { headers });
  if (!resp.ok) {
    const remaining = resp.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      const reset = resp.headers.get("x-ratelimit-reset");
      throw new Error(`RATE_LIMITED:${reset}`);
    }
    throw new Error(`GitHub API ${resp.status}: ${resp.statusText}`);
  }
  return resp.json();
}

// Fetch repo metadata (stars, forks, watchers)
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
    openIssues: data.open_issues_count,
    description: data.description,
    createdAt: data.created_at,
  };
  setCache(key, result);
  return result;
}

// Sample stargazers and analyze their profiles
async function sampleStargazers(owner, repo, token, sampleSize = 100, knownStarCount) {
  const key = `stargazers:${owner}/${repo}:${sampleSize}`;
  const cached = getCached(key);
  if (cached) return cached;

  const perPage = 30;

  // Use known star count to avoid an extra API call
  let totalStars = knownStarCount;
  if (!totalStars) {
    const repoData = await githubFetch(
      `https://api.github.com/repos/${owner}/${repo}`,
      token
    );
    totalStars = repoData.stargazers_count;
  }
  const totalPages = Math.ceil(totalStars / perPage);

  // Pick pages spread evenly (beginning, middle, end)
  const pagesToFetch = [];
  if (totalPages <= 4) {
    for (let i = 1; i <= totalPages; i++) pagesToFetch.push(i);
  } else {
    const step = Math.max(1, Math.floor(totalPages / 4));
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
      allUsers = allUsers.concat(users);
    } catch (e) {
      if (e.message.startsWith("RATE_LIMITED")) throw e;
      // Skip failed pages
    }
  }

  // Deduplicate and limit sample
  const seen = new Set();
  const uniqueUsers = allUsers.filter((u) => {
    if (!u || !u.login || seen.has(u.login)) return false;
    seen.add(u.login);
    return true;
  });
  const sample = uniqueUsers.slice(0, sampleSize);

  // Fetch detailed profiles (in batches to respect rate limits)
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

  const analysis = analyzeProfiles(profiles);
  setCache(key, analysis);
  return analysis;
}

function hasDefaultAvatar(avatarUrl) {
  // GitHub auto-generated avatars (identicons) follow this pattern:
  // https://avatars.githubusercontent.com/u/{id}?v=4
  // Users who set a custom avatar get a different URL or have a hash in it.
  // The simplest heuristic: identicons have no specific image hash parameter.
  // Also, GitHub's generated avatars have no "?" or have just "?v=4" with no "s=" sizing param from user upload.
  if (!avatarUrl) return true;
  // Avatars with /u/ and no additional path segments are auto-generated identicons
  return /\/u\/\d+\?/.test(avatarUrl) && !avatarUrl.includes("&s=");
}

function analyzeProfiles(profiles) {
  if (profiles.length === 0) {
    return {
      sampleSize: 0,
      zeroReposPercent: 0,
      zeroFollowersPercent: 0,
      zeroStarsPercent: 0,
      defaultAvatarPercent: 0,
      ghostPercent: 0,
      avgPublicRepos: 0,
      avgFollowers: 0,
      medianAccountAgeDays: 0,
    };
  }

  const now = Date.now();
  let zeroRepos = 0;
  let zeroFollowers = 0;
  let zeroStars = 0; // accounts with 0 public gists and 0 repos (proxy for no starring activity)
  let defaultAvatars = 0;
  let ghosts = 0; // zero repos + zero followers + no bio + default avatar
  let totalRepos = 0;
  let totalFollowers = 0;
  const accountAges = [];

  for (const p of profiles) {
    const repos = p.public_repos || 0;
    const followers = p.followers || 0;
    const following = p.following || 0;
    const gists = p.public_gists || 0;
    const hasBio = !!(p.bio && p.bio.trim());
    const isDefaultAvatar = hasDefaultAvatar(p.avatar_url);
    const ageDays = (now - new Date(p.created_at).getTime()) / 86400000;

    if (repos === 0) zeroRepos++;
    if (followers === 0) zeroFollowers++;
    if (repos === 0 && gists === 0 && following === 0) zeroStars++;
    if (isDefaultAvatar) defaultAvatars++;
    // Ghost = no repos, no followers, no bio, default avatar — a truly empty account
    if (repos === 0 && followers === 0 && !hasBio && isDefaultAvatar) ghosts++;

    totalRepos += repos;
    totalFollowers += followers;
    accountAges.push(ageDays);
  }

  accountAges.sort((a, b) => a - b);
  const median =
    accountAges.length % 2 === 0
      ? (accountAges[accountAges.length / 2 - 1] +
          accountAges[accountAges.length / 2]) /
        2
      : accountAges[Math.floor(accountAges.length / 2)];

  return {
    sampleSize: profiles.length,
    zeroReposPercent: Math.round((zeroRepos / profiles.length) * 100),
    zeroFollowersPercent: Math.round((zeroFollowers / profiles.length) * 100),
    zeroStarsPercent: Math.round((zeroStars / profiles.length) * 100),
    defaultAvatarPercent: Math.round((defaultAvatars / profiles.length) * 100),
    ghostPercent: Math.round((ghosts / profiles.length) * 100),
    avgPublicRepos: Math.round((totalRepos / profiles.length) * 10) / 10,
    avgFollowers: Math.round((totalFollowers / profiles.length) * 10) / 10,
    medianAccountAgeDays: Math.round(median),
  };
}

function computeTrustScore(repoInfo, stargazerAnalysis) {
  // Score from 0-100 where 100 = very likely organic
  let score = 100;
  const signals = [];

  // 1. Fork-to-star ratio (organic ~0.16, fake <0.05)
  const forkRatio =
    repoInfo.stars > 0 ? repoInfo.forks / repoInfo.stars : 0;
  if (forkRatio < 0.02) {
    score -= 30;
    signals.push({
      signal: "Very low fork/star ratio",
      value: forkRatio.toFixed(3),
      severity: "high",
      detail: "Organic repos average ~0.16. Below 0.02 is a strong fake signal.",
    });
  } else if (forkRatio < 0.05) {
    score -= 20;
    signals.push({
      signal: "Low fork/star ratio",
      value: forkRatio.toFixed(3),
      severity: "medium",
      detail: "Below 0.05 warrants scrutiny per CMU research.",
    });
  } else {
    signals.push({
      signal: "Fork/star ratio",
      value: forkRatio.toFixed(3),
      severity: "ok",
      detail: "Within normal range (organic avg ~0.16).",
    });
  }

  // 2. Watcher-to-star ratio (healthy 0.005-0.03, fake <0.001)
  const watcherRatio =
    repoInfo.stars > 0 ? repoInfo.watchers / repoInfo.stars : 0;
  if (watcherRatio < 0.001) {
    score -= 20;
    signals.push({
      signal: "Very low watcher/star ratio",
      value: watcherRatio.toFixed(4),
      severity: "high",
      detail: "Healthy repos: 0.005-0.030. Below 0.001 suggests inflated stars.",
    });
  } else if (watcherRatio < 0.005) {
    score -= 10;
    signals.push({
      signal: "Low watcher/star ratio",
      value: watcherRatio.toFixed(4),
      severity: "medium",
      detail: "Slightly below healthy range of 0.005-0.030.",
    });
  } else {
    signals.push({
      signal: "Watcher/star ratio",
      value: watcherRatio.toFixed(4),
      severity: "ok",
      detail: "Within healthy range (0.005-0.030).",
    });
  }

  // 3. Stargazer profile signals (if available)
  if (stargazerAnalysis && stargazerAnalysis.sampleSize > 0) {
    // Zero repos percentage (organic 2-6%, fake 32-81%)
    if (stargazerAnalysis.zeroReposPercent > 50) {
      score -= 25;
      signals.push({
        signal: "High % stargazers with 0 repos",
        value: `${stargazerAnalysis.zeroReposPercent}%`,
        severity: "high",
        detail: "Organic: 2-6%. Manipulated repos: 32-81%.",
      });
    } else if (stargazerAnalysis.zeroReposPercent > 20) {
      score -= 12;
      signals.push({
        signal: "Elevated % stargazers with 0 repos",
        value: `${stargazerAnalysis.zeroReposPercent}%`,
        severity: "medium",
        detail: "Above organic baseline of 2-6%.",
      });
    } else {
      signals.push({
        signal: "Stargazers with 0 repos",
        value: `${stargazerAnalysis.zeroReposPercent}%`,
        severity: "ok",
        detail: "Within organic range (2-6%).",
      });
    }

    // Zero followers percentage (organic 5-12%, fake 52-81%)
    if (stargazerAnalysis.zeroFollowersPercent > 40) {
      score -= 20;
      signals.push({
        signal: "High % stargazers with 0 followers",
        value: `${stargazerAnalysis.zeroFollowersPercent}%`,
        severity: "high",
        detail: "Organic: 5-12%. Manipulated: 52-81%.",
      });
    } else if (stargazerAnalysis.zeroFollowersPercent > 15) {
      score -= 10;
      signals.push({
        signal: "Elevated % stargazers with 0 followers",
        value: `${stargazerAnalysis.zeroFollowersPercent}%`,
        severity: "medium",
        detail: "Above organic baseline of 5-12%.",
      });
    } else {
      signals.push({
        signal: "Stargazers with 0 followers",
        value: `${stargazerAnalysis.zeroFollowersPercent}%`,
        severity: "ok",
        detail: "Within organic range (5-12%).",
      });
    }

    // Zero activity accounts (no repos, no gists, no following — just a star-bot)
    if (stargazerAnalysis.zeroStarsPercent > 40) {
      score -= 15;
      signals.push({
        signal: "High % zero-activity stargazers",
        value: `${stargazerAnalysis.zeroStarsPercent}%`,
        severity: "high",
        detail: "Accounts with no repos, no gists, no following — only star.",
      });
    } else if (stargazerAnalysis.zeroStarsPercent > 15) {
      score -= 7;
      signals.push({
        signal: "Elevated % zero-activity stargazers",
        value: `${stargazerAnalysis.zeroStarsPercent}%`,
        severity: "medium",
        detail: "Accounts that exist solely to star repos.",
      });
    } else {
      signals.push({
        signal: "Zero-activity stargazers",
        value: `${stargazerAnalysis.zeroStarsPercent}%`,
        severity: "ok",
        detail: "Low percentage of star-only accounts.",
      });
    }

    // Default avatar (no custom profile picture — never personalized)
    if (stargazerAnalysis.defaultAvatarPercent > 50) {
      score -= 15;
      signals.push({
        signal: "High % default avatars",
        value: `${stargazerAnalysis.defaultAvatarPercent}%`,
        severity: "high",
        detail: "Most stargazers never set a profile picture — bot signal.",
      });
    } else if (stargazerAnalysis.defaultAvatarPercent > 25) {
      score -= 7;
      signals.push({
        signal: "Elevated % default avatars",
        value: `${stargazerAnalysis.defaultAvatarPercent}%`,
        severity: "medium",
        detail: "Above typical rates for organic repos.",
      });
    } else {
      signals.push({
        signal: "Default avatars",
        value: `${stargazerAnalysis.defaultAvatarPercent}%`,
        severity: "ok",
        detail: "Most stargazers have custom profile pictures.",
      });
    }

    // Ghost accounts (organic ~1%, fake 19-28%) — now includes avatar check
    if (stargazerAnalysis.ghostPercent > 15) {
      score -= 20;
      signals.push({
        signal: "High % ghost accounts",
        value: `${stargazerAnalysis.ghostPercent}%`,
        severity: "high",
        detail: "No repos, no followers, no bio, default avatar. Organic: ~1%.",
      });
    } else if (stargazerAnalysis.ghostPercent > 5) {
      score -= 8;
      signals.push({
        signal: "Elevated % ghost accounts",
        value: `${stargazerAnalysis.ghostPercent}%`,
        severity: "medium",
        detail: "Above organic baseline of ~1%.",
      });
    } else {
      signals.push({
        signal: "Ghost accounts",
        value: `${stargazerAnalysis.ghostPercent}%`,
        severity: "ok",
        detail: "Within organic range (~1%).",
      });
    }
  }

  score = Math.max(0, Math.min(100, score));

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

  return { score, grade, label, signals, forkRatio, watcherRatio };
}

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "ANALYZE_REPO") {
    handleAnalyze(msg.owner, msg.repo, msg.pageData).then(sendResponse).catch((err) =>
      sendResponse({ error: err.message })
    );
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
    validateToken(msg.token).then(sendResponse).catch((err) =>
      sendResponse({ valid: false, error: err.message })
    );
    return true;
  }

  // Fallback: always respond so the message port doesn't hang
  sendResponse({ error: "unknown_message_type" });
  return false;
});

const MIN_STARS_THRESHOLD = 10;

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

async function handleAnalyze(owner, repo, pageData) {
  const { githubToken } = await chrome.storage.sync.get("githubToken");
  const token = githubToken || null;
  const hasToken = !!token;

  let repoInfo;

  // If content script sent us page-scraped data, use it to save 1 API call
  if (pageData && pageData.stars != null) {
    repoInfo = {
      stars: pageData.stars,
      forks: pageData.forks,
      watchers: pageData.watchers,
      openIssues: 0,
      description: "",
      createdAt: "",
    };
    // If page data is incomplete, supplement from API
    if (repoInfo.watchers == null) {
      const apiData = await fetchRepoInfo(owner, repo, token);
      repoInfo.watchers = apiData.watchers;
    }
  } else {
    repoInfo = await fetchRepoInfo(owner, repo, token);
  }

  // Hide for repos with insufficient stars
  if (repoInfo.stars < MIN_STARS_THRESHOLD) {
    return { hide: true };
  }

  // Quick analysis with just ratios if stars < 50
  if (repoInfo.stars < 50) {
    const result = computeTrustScore(repoInfo, null);
    return { repoInfo, stargazerAnalysis: null, trust: result, smallRepo: true };
  }

  // Adjust sample size based on auth status to conserve API budget.
  // Without token: 60 req/hr — use a small sample (20 profiles = ~25 API calls total).
  // With token: 5,000 req/hr — use a larger sample for better accuracy.
  const sampleSize = hasToken
    ? (repoInfo.stars > 10000 ? 100 : 60)
    : 20;

  let stargazerAnalysis = null;
  try {
    stargazerAnalysis = await sampleStargazers(owner, repo, token, sampleSize, repoInfo.stars);
  } catch (e) {
    if (e.message.startsWith("RATE_LIMITED")) {
      const reset = e.message.split(":")[1];
      // Still return ratio-based analysis even when rate limited
      const trust = computeTrustScore(repoInfo, null);
      return {
        repoInfo,
        stargazerAnalysis: null,
        trust,
        smallRepo: false,
        rateLimited: true,
        resetAt: parseInt(reset),
      };
    }
    // Continue without stargazer analysis
  }

  const trust = computeTrustScore(repoInfo, stargazerAnalysis);
  return { repoInfo, stargazerAnalysis, trust, smallRepo: false };
}
