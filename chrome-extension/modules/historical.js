// Module 13: Historical Tracking (uses chrome.storage)

export async function getHistorical(owner, repo) {
  try {
    const key = `history:${owner}/${repo}`;
    const result = await chrome.storage.local.get(key);
    return result[key] || null;
  } catch {
    return null;
  }
}

export async function saveHistorical(owner, repo, score, grade, stars) {
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
