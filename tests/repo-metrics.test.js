import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeRepoMetrics } from "../chrome-extension/modules/repo-metrics.js";

describe("analyzeRepoMetrics", () => {
  it("returns neutral score for 0 stars", () => {
    const result = analyzeRepoMetrics({ stars: 0, forks: 0, watchers: 0 });
    assert.equal(result.subscore, 0.5);
    assert.equal(result.signals.length, 0);
  });

  it("scores high for healthy ratios", () => {
    const result = analyzeRepoMetrics({ stars: 1000, forks: 160, watchers: 10 });
    assert.equal(result.subscore, 1.0);
    assert.equal(result.signals.length, 2);
    assert.ok(result.signals.every((s) => s.severity === "ok"));
  });

  it("flags very low fork/star ratio", () => {
    const result = analyzeRepoMetrics({ stars: 5000, forks: 5, watchers: 50 });
    assert.ok(result.subscore < 0.6);
    const forkSignal = result.signals.find((s) => s.signal.includes("fork/star"));
    assert.equal(forkSignal.severity, "high");
  });

  it("flags medium fork/star ratio", () => {
    const result = analyzeRepoMetrics({ stars: 1000, forks: 30, watchers: 10 });
    const forkSignal = result.signals.find((s) => s.signal.includes("fork/star"));
    assert.equal(forkSignal.severity, "medium");
  });

  it("flags very low watcher/star ratio", () => {
    const result = analyzeRepoMetrics({ stars: 10000, forks: 1600, watchers: 2 });
    const watcherSignal = result.signals.find((s) => s.signal.includes("watcher/star"));
    assert.equal(watcherSignal.severity, "high");
  });

  it("flags medium watcher/star ratio", () => {
    const result = analyzeRepoMetrics({ stars: 1000, forks: 160, watchers: 3 });
    const watcherSignal = result.signals.find((s) => s.signal.includes("watcher/star"));
    assert.equal(watcherSignal.severity, "medium");
  });

  it("clamps subscore to [0, 1]", () => {
    // Extreme case: both ratios trigger high severity
    const result = analyzeRepoMetrics({ stars: 100000, forks: 1, watchers: 1 });
    assert.ok(result.subscore >= 0);
    assert.ok(result.subscore <= 1);
  });

  it("returns forkRatio and watcherRatio", () => {
    const result = analyzeRepoMetrics({ stars: 500, forks: 80, watchers: 5 });
    assert.equal(result.forkRatio, 80 / 500);
    assert.equal(result.watcherRatio, 5 / 500);
  });
});
