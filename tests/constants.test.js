import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MODULE_WEIGHTS,
  determineAnalysisDepth,
  getProfileSampleSize,
} from "../chrome-extension/modules/constants.js";

describe("MODULE_WEIGHTS", () => {
  it("sum to 1.0", () => {
    const total = Object.values(MODULE_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1.0) < 0.001, `Weights sum to ${total}, expected 1.0`);
  });
});

describe("determineAnalysisDepth", () => {
  it("returns quick without token", () => {
    assert.equal(determineAnalysisDepth(false, 5000), "quick");
  });

  it("returns standard with token but low budget", () => {
    assert.equal(determineAnalysisDepth(true, 50), "standard");
  });

  it("returns deep with token and adequate budget", () => {
    assert.equal(determineAnalysisDepth(true, 4000), "deep");
  });

  it("returns deep with token when budget is not known yet", () => {
    assert.equal(determineAnalysisDepth(true, null), "deep");
  });

  it("returns standard at exactly 99 remaining", () => {
    assert.equal(determineAnalysisDepth(true, 99), "standard");
  });

  it("returns deep at exactly 100 remaining", () => {
    assert.equal(determineAnalysisDepth(true, 100), "deep");
  });
});

describe("getProfileSampleSize", () => {
  it("returns 20 for quick", () => {
    assert.equal(getProfileSampleSize("quick", 500), 20);
  });

  it("returns 40 for standard", () => {
    assert.equal(getProfileSampleSize("standard", 500), 40);
  });

  it("returns 60 for deep with small repo", () => {
    assert.equal(getProfileSampleSize("deep", 500), 60);
  });

  it("returns 100 for deep with large repo", () => {
    assert.equal(getProfileSampleSize("deep", 15000), 100);
  });

  it("returns 20 for unknown depth", () => {
    assert.equal(getProfileSampleSize("unknown", 500), 20);
  });
});
