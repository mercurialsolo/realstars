// Module 4: Stargazer Profile Quality (weight: 0.15)

import { githubFetch } from "./github-api.js";
import { getCached, setCache } from "./cache.js";

export function hasDefaultAvatar(avatarUrl) {
  if (!avatarUrl) return true;
  return /\/u\/\d+\?/.test(avatarUrl) && !avatarUrl.includes("&s=");
}

export async function sampleStargazerProfiles(owner, repo, token, sampleSize, starCount) {
  const key = `profiles:${owner}/${repo}:${sampleSize}`;
  const cached = getCached(key);
  if (cached) return cached;

  const perPage = 30;
  const totalPages = Math.ceil(starCount / perPage);

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

  const seen = new Set();
  const uniqueUsers = allUsers.filter((u) => {
    if (!u || !u.login || seen.has(u.login)) return false;
    seen.add(u.login);
    return true;
  });
  const sample = uniqueUsers.slice(0, sampleSize);

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

export function analyzeProfileQuality(profiles) {
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
  let zeroActivity = 0;
  let ghosts = 0;
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

  // Zero activity
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
