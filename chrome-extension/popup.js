// RealStars - Popup Script

document.addEventListener("DOMContentLoaded", () => {
  const tokenInput = document.getElementById("token-input");
  const saveTokenBtn = document.getElementById("save-token");
  const tokenStatus = document.getElementById("token-status");
  const repoInput = document.getElementById("repo-input");
  const checkBtn = document.getElementById("check-btn");
  const resultDiv = document.getElementById("result");

  // Load saved token
  chrome.runtime.sendMessage({ type: "GET_TOKEN" }, (resp) => {
    if (resp && resp.token) {
      tokenInput.value = resp.token;
      tokenStatus.textContent = "Token saved";
      tokenStatus.className = "status success";
    }
  });

  saveTokenBtn.addEventListener("click", () => {
    const token = tokenInput.value.trim();
    chrome.runtime.sendMessage({ type: "SET_TOKEN", token }, () => {
      tokenStatus.textContent = token ? "Token saved!" : "Token cleared";
      tokenStatus.className = "status success";
    });
  });

  checkBtn.addEventListener("click", async () => {
    const input = repoInput.value.trim();
    const match = input.match(
      /(?:github\.com\/)?([^/\s]+)\/([^/\s#?]+)/
    );
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

  // Allow Enter key
  repoInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") checkBtn.click();
  });

  function renderResult(result) {
    if (result.error) {
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
