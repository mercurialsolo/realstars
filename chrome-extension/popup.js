// RealStars - Popup Script

// GitHub token creation URL without repo scopes; public API reads only need authentication.
const TOKEN_CREATE_URL =
  "https://github.com/settings/tokens/new?description=RealStars%20Star%20Fact%20Checker";

// Promise wrapper for chrome.runtime.sendMessage to avoid callback nesting
function sendMsg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ _error: chrome.runtime.lastError.message });
      } else {
        resolve(resp);
      }
    });
  });
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function safeSeverity(severity) {
  return ["ok", "low", "medium", "high", "neutral"].includes(severity)
    ? severity
    : "neutral";
}

function safeGrade(grade) {
  return ["A", "B", "C", "D", "F"].includes(grade) ? grade : "C";
}

document.addEventListener("DOMContentLoaded", async () => {
  const tokenInput = document.getElementById("token-input");
  const saveTokenBtn = document.getElementById("save-token");
  const tokenStatus = document.getElementById("token-status");
  const createTokenLink = document.getElementById("create-token-link");
  const deleteTokenBtn = document.getElementById("delete-token-btn");
  const refreshTokenBtn = document.getElementById("refresh-token-btn");
  const connectedDiv = document.getElementById("token-connected");
  const disconnectedDiv = document.getElementById("token-disconnected");
  const tokenUserSpan = document.getElementById("token-user");
  const tokenRateSpan = document.getElementById("token-rate");
  const repoInput = document.getElementById("repo-input");
  const checkBtn = document.getElementById("check-btn");
  const resultDiv = document.getElementById("result");

  // --- Token UI helpers ---

  function showConnected(user, rateLimit, rateRemaining) {
    connectedDiv.style.display = "block";
    disconnectedDiv.style.display = "none";
    tokenUserSpan.textContent = user;
    if (rateLimit != null) {
      tokenRateSpan.textContent = `${rateRemaining.toLocaleString()} / ${rateLimit.toLocaleString()} requests remaining`;
    } else {
      tokenRateSpan.textContent = "5,000 requests/hour";
    }
  }

  function showDisconnected(message) {
    connectedDiv.style.display = "none";
    disconnectedDiv.style.display = "block";
    tokenInput.value = "";
    if (message) {
      tokenStatus.textContent = message;
      tokenStatus.className = "status error";
    } else {
      tokenStatus.textContent = "";
      tokenStatus.className = "status";
    }
  }

  // --- Load saved token on popup open ---

  const stored = await sendMsg({ type: "GET_TOKEN" });
  if (stored && stored.token) {
    const validation = await sendMsg({ type: "VALIDATE_TOKEN", token: stored.token });
    if (validation && validation.valid) {
      showConnected(validation.user, validation.rateLimit, validation.rateRemaining);
    } else {
      showDisconnected("Saved token is invalid. Please create a new one.");
    }
  } else {
    showDisconnected();
  }

  // --- Token actions ---

  // 1-click: open GitHub token creation page with pre-filled permissions
  createTokenLink.addEventListener("click", () => {
    chrome.tabs.create({ url: TOKEN_CREATE_URL });
  });

  // Save token
  saveTokenBtn.addEventListener("click", async () => {
    const token = tokenInput.value.trim();
    if (!token) {
      tokenStatus.textContent = "Please enter a token.";
      tokenStatus.className = "status error";
      return;
    }

    saveTokenBtn.disabled = true;
    saveTokenBtn.textContent = "Validating...";
    tokenStatus.textContent = "";

    const validation = await sendMsg({ type: "VALIDATE_TOKEN", token });
    saveTokenBtn.disabled = false;
    saveTokenBtn.textContent = "Save";

    if (validation && validation.valid) {
      await sendMsg({ type: "SET_TOKEN", token });
      showConnected(validation.user, validation.rateLimit, validation.rateRemaining);
    } else {
      tokenStatus.textContent = `Invalid token: ${validation?.error || "unknown error"}`;
      tokenStatus.className = "status error";
    }
  });

  // Delete token
  deleteTokenBtn.addEventListener("click", async () => {
    await sendMsg({ type: "DELETE_TOKEN" });
    showDisconnected();
  });

  // Refresh token status
  refreshTokenBtn.addEventListener("click", async () => {
    refreshTokenBtn.disabled = true;
    refreshTokenBtn.textContent = "...";

    const stored = await sendMsg({ type: "GET_TOKEN" });
    if (stored && stored.token) {
      const validation = await sendMsg({ type: "VALIDATE_TOKEN", token: stored.token });
      refreshTokenBtn.disabled = false;
      refreshTokenBtn.textContent = "Refresh";
      if (validation && validation.valid) {
        showConnected(validation.user, validation.rateLimit, validation.rateRemaining);
      } else {
        showDisconnected("Token expired or revoked. Please create a new one.");
      }
    } else {
      refreshTokenBtn.disabled = false;
      refreshTokenBtn.textContent = "Refresh";
      showDisconnected();
    }
  });

  // Allow Enter in token input
  tokenInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveTokenBtn.click();
  });

  // --- Repo Check ---

  checkBtn.addEventListener("click", async () => {
    const input = repoInput.value.trim();
    const match = input.match(/(?:github\.com\/)?([^/\s]+)\/([^/\s#?]+)/);
    if (!match) {
      resultDiv.style.display = "block";
      resultDiv.innerHTML =
        '<div class="status error">Enter a valid repo: owner/repo</div>';
      return;
    }

    const owner = match[1];
    const repo = match[2].replace(/\.git$/, "");

    checkBtn.disabled = true;
    checkBtn.textContent = "Checking...";
    resultDiv.style.display = "block";
    resultDiv.innerHTML =
      '<div class="status">Analyzing stargazer profiles...</div>';

    const result = await sendMsg({ type: "ANALYZE_REPO", owner, repo });
    checkBtn.disabled = false;
    checkBtn.textContent = "Check";

    if (result && result._error) {
      resultDiv.innerHTML = `<div class="status error">Error: ${escapeHTML(result._error)}</div>`;
    } else {
      renderResult(result);
    }
  });

  repoInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") checkBtn.click();
  });

  function renderResult(result) {
    if (!result) {
      resultDiv.innerHTML = '<div class="status error">No response from extension background worker.</div>';
      return;
    }

    if (result.hide) {
      const message = result.reason === "private"
        ? "Private repositories are not analyzed."
        : "Repo has fewer than 10 stars — not enough data to analyze.";
      resultDiv.innerHTML = `<div class="status">${escapeHTML(message)}</div>`;
      return;
    }

    if (result.error && !result.trust) {
      if (result.error === "rate_limited") {
        const resetTime = new Date(result.resetAt * 1000).toLocaleTimeString();
        resultDiv.innerHTML = `<div class="status error">Rate limited. Resets at ${resetTime}. Add a GitHub token for higher limits.</div>`;
      } else {
        resultDiv.innerHTML = `<div class="status error">${escapeHTML(result.error)}</div>`;
      }
      return;
    }

    if (!result.trust) {
      resultDiv.innerHTML = '<div class="status error">Analysis did not return a trust score.</div>';
      return;
    }

    const { trust } = result;
    const grade = safeGrade(trust.grade);
    const score = Number.isFinite(Number(trust.score)) ? Number(trust.score) : 0;
    const gradeColors = {
      A: { bg: "#dafbe1", fg: "#116329", border: "#4ac26b" },
      B: { bg: "#ddf4ff", fg: "#0550ae", border: "#54aeff" },
      C: { bg: "#fff8c5", fg: "#6a5300", border: "#d4a72c" },
      D: { bg: "#ffebe9", fg: "#82071e", border: "#ff8182" },
      F: { bg: "#ffcecb", fg: "#6e011a", border: "#ff4a4a" },
    };
    const c = gradeColors[grade];

    const signalsHTML = (trust.signals || [])
      .map(
        (s) => {
          const severity = safeSeverity(s.severity);
          return `
        <div class="signal-item">
          <span><span class="signal-dot ${severity}"></span>${escapeHTML(s.signal)}</span>
          <span style="font-family:monospace;font-weight:600">${escapeHTML(s.value)}</span>
        </div>
      `;
        }
      )
      .join("");

    resultDiv.innerHTML = `
      <div class="score-bar" style="background:${c.bg}">
        <div class="grade-display" style="color:${c.fg};border-color:${c.border}">${grade}</div>
        <div class="score-info">
          <div class="label" style="color:${c.fg}">${escapeHTML(trust.label)}</div>
          <div class="score-num">Score: ${score}/100</div>
        </div>
      </div>
      <div class="signal-list">${signalsHTML}</div>
    `;
  }
});
