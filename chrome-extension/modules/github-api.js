// GitHub API fetch with rate-limit tracking and retry with exponential backoff

let apiCallsRemaining = null; // Unknown until GitHub returns rate-limit headers.
let apiResetTime = 0;

export function getApiCallsRemaining() {
  return apiCallsRemaining;
}

export function getApiResetTime() {
  return apiResetTime;
}

export function resetApiState() {
  apiCallsRemaining = null;
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
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;

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
      const parsedRemaining = remaining !== null ? parseInt(remaining, 10) : null;
      if (parsedRemaining !== null && !Number.isNaN(parsedRemaining)) {
        apiCallsRemaining = parsedRemaining;
      }
      if (reset !== null) {
        const parsedReset = parseInt(reset, 10);
        if (!Number.isNaN(parsedReset)) apiResetTime = parsedReset;
      }

      if (resp.ok) return resp.json();

      let errorMessage = resp.statusText || "";
      try {
        const body = await resp.json();
        if (body && typeof body.message === "string") {
          errorMessage = body.message;
        }
      } catch {
        // Some error responses have no JSON body.
      }

      // Rate limited — throw immediately, never retry. Not every 403 is a
      // rate limit; private/forbidden resources should surface as 403s.
      const looksRateLimited =
        resp.status === 429 ||
        (resp.status === 403 &&
          (parsedRemaining === 0 || /rate limit|secondary rate/i.test(errorMessage)));
      if (looksRateLimited) {
        throw new Error(`RATE_LIMITED:${reset || apiResetTime || 0}`);
      }

      // Server errors (5xx) — retry with backoff
      if (resp.status >= 500 && attempt < maxRetries) {
        await sleep(baseDelayMs * Math.pow(2, attempt));
        continue;
      }

      throw new Error(`GitHub API ${resp.status}: ${errorMessage || resp.statusText}`);
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
