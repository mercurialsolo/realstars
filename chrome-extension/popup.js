// RealStars - Popup Script

// GitHub token creation URL with pre-selected scopes (read-only public_repo)
const TOKEN_CREATE_URL =
  "https://github.com/settings/tokens/new?description=RealStars%20Star%20Fact%20Checker&scopes=public_repo";

document.addEventListener("DOMContentLoaded", () => {
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

  // --- Token Management ---

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

  function showDisconnected() {
    connectedDiv.style.display = "none";
    disconnectedDiv.style.display = "block";
    tokenInput.value = "";
    tokenStatus.textContent = "";
    tokenStatus.className = "status";
  }

  // Load saved token and validate on popup open
  chrome.runtime.sendMessage({ type: "GET_TOKEN" }, (resp) => {
    if (resp && resp.token) {
      // Validate the saved token
      chrome.runtime.sendMessage(
        { type: "VALIDATE_TOKEN", token: resp.token },
        (validation) => {
          if (validation && validation.valid) {
            showConnected(validation.user, validation.rateLimit, validation.rateRemaining);
          } else {
            showDisconnected();
            tokenStatus.textContent = "Saved token is invalid. Please create a new one.";
            tokenStatus.className = "status error";
          }
        }
      );
    } else {
      showDisconnected();
    }
  });

  // 1-click: open GitHub token creation page with pre-filled permissions
  createTokenLink.addEventListener("click", () => {
    chrome.tabs.create({ url: TOKEN_CREATE_URL });
  });

  // Save token
  saveTokenBtn.addEventListener("click", () => {
    const token = tokenInput.value.trim();
    if (!token) {
      tokenStatus.textContent = "Please enter a token.";
      tokenStatus.className = "status error";
      return;
    }

    saveTokenBtn.disabled = true;
    saveTokenBtn.textContent = "Validating...";
    tokenStatus.textContent = "";

    chrome.runtime.sendMessage(
      { type: "VALIDATE_TOKEN", token },
      (validation) => {
        saveTokenBtn.disabled = false;
        saveTokenBtn.textContent = "Save";

        if (validation && validation.valid) {
          chrome.runtime.sendMessage({ type: "SET_TOKEN", token }, () => {
            showConnected(validation.user, validation.rateLimit, validation.rateRemaining);
          });
        } else {
          tokenStatus.textContent = `Invalid token: ${validation?.error || "unknown error"}`;
          tokenStatus.className = "status error";
        }
      }
    );
  });

  // Delete token
  deleteTokenBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "DELETE_TOKEN" }, () => {
      showDisconnected();
    });
  });

  // Refresh token status
  refreshTokenBtn.addEventListener("click", () => {
    refreshTokenBtn.disabled = true;
    refreshTokenBtn.textContent = "...";
    chrome.runtime.sendMessage({ type: "GET_TOKEN" }, (resp) => {
      if (resp && resp.token) {
        chrome.runtime.sendMessage(
          { type: "VALIDATE_TOKEN", token: resp.token },
          (validation) => {
            refreshTokenBtn.disabled = false;
            refreshTokenBtn.textContent = "Refresh";
            if (validation && validation.valid) {
              showConnected(validation.user, validation.rateLimit, validation.rateRemaining);
            } else {
              showDisconnected();
              tokenStatus.textContent = "Token expired or revoked. Please create a new one.";
              tokenStatus.className = "status error";
            }
          }
        );
      } else {
        refreshTokenBtn.disabled = false;
        refreshTokenBtn.textContent = "Refresh";
        showDisconnected();
      }
    });
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

    try {
      const result = await chrome.runtime.sendMessage({
        type: "ANALYZE_REPO",
        owner,
        repo,
      });
      renderResult(result);
    } catch (err) {
      resultDiv.innerHTML = `<div class="status error">Error: ${err.message}</div>`;
    } finally {
      checkBtn.disabled = false;
      checkBtn.textContent = "Check";
    }
  });

  repoInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") checkBtn.click();
  });

  function renderResult(result) {
    if (result.hide) {
      resultDiv.innerHTML =
        '<div class="status">Repo has fewer than 10 stars — not enough data to analyze.</div>';
      return;
    }

    if (result.error && !result.trust) {
      if (result.error === "rate_limited") {
        const resetTime = new Date(result.resetAt * 1000).toLocaleTimeString();
        resultDiv.innerHTML = `<div class="status error">Rate limited. Resets at ${resetTime}. Add a GitHub token for higher limits.</div>`;
      } else {
        resultDiv.innerHTML = `<div class="status error">${result.error}</div>`;
      }
      return;
    }

    const { trust } = result;
    const gradeColors = {
      A: { bg: "#dafbe1", fg: "#116329", border: "#4ac26b" },
      B: { bg: "#ddf4ff", fg: "#0550ae", border: "#54aeff" },
      C: { bg: "#fff8c5", fg: "#6a5300", border: "#d4a72c" },
      D: { bg: "#ffebe9", fg: "#82071e", border: "#ff8182" },
      F: { bg: "#ffcecb", fg: "#6e011a", border: "#ff4a4a" },
    };
    const c = gradeColors[trust.grade];

    const signalsHTML = trust.signals
      .map(
        (s) => `
        <div class="signal-item">
          <span><span class="signal-dot ${s.severity}"></span>${s.signal}</span>
          <span style="font-family:monospace;font-weight:600">${s.value}</span>
        </div>
      `
      )
      .join("");

    resultDiv.innerHTML = `
      <div class="score-bar" style="background:${c.bg}">
        <div class="grade-display" style="color:${c.fg};border-color:${c.border}">${trust.grade}</div>
        <div class="score-info">
          <div class="label" style="color:${c.fg}">${trust.label}</div>
          <div class="score-num">Score: ${trust.score}/100</div>
        </div>
      </div>
      <div class="signal-list">${signalsHTML}</div>
    `;
  }
});
