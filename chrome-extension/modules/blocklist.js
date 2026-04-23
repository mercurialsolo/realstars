// Module 11: Known Farm Blocklist (weight: 0.05)

const BUILTIN_USERNAME_PATTERNS = [
  /^(user|dev|test|bot|star|fake|dummy|temp)[-_]?\d{3,}$/i,
  /^ghost$/i,
];

function normalizeBlocklist(knownFarmsBlocklist) {
  const exact = new Set();
  const patterns = [...BUILTIN_USERNAME_PATTERNS];

  if (Array.isArray(knownFarmsBlocklist)) {
    for (const username of knownFarmsBlocklist) {
      if (typeof username === "string" && username.trim()) {
        exact.add(username.trim().toLowerCase());
      }
    }
    return { exact, patterns };
  }

  if (knownFarmsBlocklist && typeof knownFarmsBlocklist === "object") {
    const exactUsernames = Array.isArray(knownFarmsBlocklist.exactUsernames)
      ? knownFarmsBlocklist.exactUsernames
      : [];
    for (const username of exactUsernames) {
      if (typeof username === "string" && username.trim()) {
        exact.add(username.trim().toLowerCase());
      }
    }

    const usernamePatterns = Array.isArray(knownFarmsBlocklist.usernamePatterns)
      ? knownFarmsBlocklist.usernamePatterns
      : [];
    for (const pattern of usernamePatterns) {
      if (typeof pattern !== "string" || pattern.length > 200) continue;
      try {
        patterns.push(new RegExp(pattern, "i"));
      } catch {
        // Ignore malformed community-maintained patterns.
      }
    }
  }

  return { exact, patterns };
}

export function analyzeBlocklist(profiles, knownFarmsBlocklist = []) {
  const signals = [];
  let subscore = 1.0;

  if (!profiles || profiles.length === 0) {
    return { matchCount: 0, matched: [], subscore: 0.5, signals: [] };
  }

  const blocklist = normalizeBlocklist(knownFarmsBlocklist);
  const matched = [];
  for (const p of profiles) {
    const login = (p.login || "").toLowerCase();

    if (blocklist.exact.has(login)) {
      matched.push(login);
      continue;
    }

    if (blocklist.patterns.some((pattern) => pattern.test(login))) {
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
