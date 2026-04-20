import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeCreationClustering } from "../chrome-extension/modules/creation-clustering.js";

function makeProfiles(dates) {
  return dates.map((d) => ({ created_at: d }));
}

describe("analyzeCreationClustering", () => {
  it("returns neutral for insufficient profiles", () => {
    const result = analyzeCreationClustering([{ created_at: "2024-01-01" }]);
    assert.equal(result.subscore, 0.5);
  });

  it("returns neutral for null", () => {
    const result = analyzeCreationClustering(null);
    assert.equal(result.subscore, 0.5);
  });

  it("scores high for well-distributed creation dates", () => {
    const profiles = makeProfiles([
      "2020-01-15", "2020-06-20", "2021-03-10",
      "2021-09-05", "2022-01-20", "2022-07-15",
      "2023-02-01", "2023-08-10", "2024-01-05",
      "2024-06-20",
    ]);
    const result = analyzeCreationClustering(profiles);
    assert.ok(result.subscore > 0.6);
    assert.ok(result.maxClusterPercent < 30);
  });

  it("flags strong clustering (>50% in one window)", () => {
    const profiles = makeProfiles([
      // 8 accounts in same 2-week window
      "2024-03-01", "2024-03-02", "2024-03-03", "2024-03-04",
      "2024-03-05", "2024-03-06", "2024-03-07", "2024-03-08",
      // 2 spread out
      "2022-01-01", "2023-06-15",
    ]);
    const result = analyzeCreationClustering(profiles);
    assert.ok(result.maxClusterPercent >= 50);
    assert.ok(result.subscore < 0.5);
    assert.equal(result.signals[0].severity, "high");
  });

  it("flags medium clustering (30-50%)", () => {
    const profiles = makeProfiles([
      // 4 in same 2-week window (keep within 3 days to avoid bin boundary)
      "2024-03-01", "2024-03-02", "2024-03-03", "2024-03-04",
      // 6 spread out
      "2020-01-01", "2020-06-01", "2021-01-01",
      "2021-06-01", "2022-01-01", "2023-01-01",
    ]);
    const result = analyzeCreationClustering(profiles);
    assert.ok(result.maxClusterPercent >= 30);
    assert.ok(result.maxClusterPercent <= 50);
    assert.equal(result.signals[0].severity, "medium");
  });

  it("returns clusterWindow string", () => {
    const profiles = makeProfiles([
      "2024-03-01", "2024-03-02", "2024-03-03", "2024-03-04", "2024-03-05",
    ]);
    const result = analyzeCreationClustering(profiles);
    assert.ok(result.clusterWindow);
    assert.ok(result.clusterWindow.includes(" to "));
  });
});
