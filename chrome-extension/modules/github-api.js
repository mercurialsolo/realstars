// GitHub API fetch with rate-limit tracking and retry with exponential backoff

let apiCallsRemaining = 60; // Conservative default (unauthenticated)
let apiResetTime = 0;

export function getApiCallsRemaining() {
  return apiCallsRemaining;
}

export function getApiResetTime() {
  return apiResetTime;
}

export function resetApiState() {
  apiCallsRemaining = 60;
  apiResetTime = 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch from the GitHub API with automatic retry on transient failures.
 *
 * Retry policy:
 *  - Up to 3 retries for 5xx server errors and network failures
 *  - Exponential backoff: 1s, 2s, 4s
 *  - Rate-limit errors (403/429) are never retried — they throw immediately
 */
export async function githubFetch(url, token, options = {}) {
  const maxRetries = 3;
  const baseDelayMs = 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const headers = {
        Accept: options.accept || "application/vnd.github+json",
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      const resp = await fetch(url, { headers });

      // Track rate limit from response headers
      const remaining = resp.headers.get("x-ratelimit-remaining");
      const reset = resp.headers.get("x-ratelimit-reset");
      if (remaining !== null) apiCallsRemaining = parseInt(remaining, 10);
      if (reset !== null) apiResetTime = parseInt(reset, 10);

      if (resp.ok) return resp.json();

      // Rate limited — throw immediately, never retry
      if (resp.status === 403 || resp.status === 429) {
        throw new Error(`RATE_LIMITED:${reset || 0}`);
      }

      // Server errors (5xx) — retry with backoff
      if (resp.status >= 500 && attempt < maxRetries) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        continue;
      }

      throw new Error(`GitHub API ${resp.status}: ${resp.statusText}`);
    } catch (err) {
      // Never retry rate limits or known client errors
      if (err.message.startsWith("RATE_LIMITED")) throw err;
      if (err.message.startsWith("GitHub API")) throw err;

      // Network errors — retry with backoff
      if (attempt < maxRetries) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        continue;
      }

      throw err;
    }
  }
}
