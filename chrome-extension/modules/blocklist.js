// Module 11: Known Farm Blocklist (weight: 0.05)

export function analyzeBlocklist(profiles, knownFarmsBlocklist = []) {
  const signals = [];
  let subscore = 1.0;

  if (!profiles || profiles.length === 0) {
    return { matchCount: 0, matched: [], subscore: 0.5, signals: [] };
  }

  const matched = [];
  for (const p of profiles) {
    const login = (p.login || "").toLowerCase();

    if (knownFarmsBlocklist.includes(login)) {
      matched.push(login);
      continue;
    }

    if (/^(user|dev|test|bot|star|fake|dummy|temp)[-_]?\d{3,}$/i.test(login)) {
      matched.push(login);
      continue;
    }

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
