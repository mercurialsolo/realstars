import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCompositeScore } from "../chrome-extension/modules/scoring.js";

describe("computeCompositeScore", () => {
  it("returns 50 when no subscores provided", () => {
    const result = computeCompositeScore({});
    assert.equal(result.score, 50);
    assert.equal(result.grade, "C");
  });

  it("returns grade A for all-perfect subscores", () => {
    const subscores = {
      repoMetrics: 1.0,
      community: 1.0,
      starTiming: 1.0,
      profiles: 1.0,
      creationClustering: 1.0,
      usernamePatterns: 1.0,
      overlap: 1.0,
      crossPlatform: 1.0,
      geographic: 1.0,
      velocity: 1.0,
      blocklist: 1.0,
    };
    const result = computeCompositeScore(subscores);
    assert.equal(result.score, 100);
    assert.equal(result.grade, "A");
    assert.equal(result.label, "Likely Organic");
  });

  it("returns grade F for all-zero subscores", () => {
    const subscores = {
      repoMetrics: 0,
      community: 0,
      starTiming: 0,
      profiles: 0,
      creationClustering: 0,
      usernamePatterns: 0,
      overlap: 0,
      crossPlatform: 0,
      geographic: 0,
      velocity: 0,
      blocklist: 0,
    };
    const result = computeCompositeScore(subscores);
    assert.equal(result.score, 0);
    assert.equal(result.grade, "F");
    assert.equal(result.label, "Highly Suspicious");
  });

  it("normalizes weights when only some modules ran", () => {
    // Only repoMetrics = 1.0 (weight 0.12)
    const result = computeCompositeScore({ repoMetrics: 1.0 });
    assert.equal(result.score, 100);
    assert.equal(result.grade, "A");
  });

  it("handles partial subscores correctly", () => {
    const subscores = {
      repoMetrics: 0.8,
      starTiming: 0.3,
      profiles: 0.2,
    };
    const result = computeCompositeScore(subscores);
    // Weighted average: (0.12*0.8 + 0.15*0.3 + 0.15*0.2) / (0.12+0.15+0.15) = 0.171/0.42 ≈ 0.407
    assert.ok(result.score >= 35 && result.score <= 45);
    assert.equal(result.grade, "C");
  });

  it("assigns correct grade boundaries", () => {
    // Grade B: 60-79
    const b = computeCompositeScore({ repoMetrics: 0.7 });
    assert.equal(b.grade, "B");

    // Grade D: 20-39
    const d = computeCompositeScore({ repoMetrics: 0.3 });
    assert.equal(d.grade, "D");
  });

  it("ignores null/undefined subscores", () => {
    const subscores = {
      repoMetrics: 1.0,
      community: null,
      starTiming: undefined,
    };
    const result = computeCompositeScore(subscores);
    assert.equal(result.score, 100);
  });

  it("clamps score to [0, 100]", () => {
    const result = computeCompositeScore({ repoMetrics: 1.5 });
    assert.ok(result.score <= 100);

    const result2 = computeCompositeScore({ repoMetrics: -0.5 });
    assert.ok(result2.score >= 0);
  });
});
