import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLocation,
  analyzeGeographicClustering,
} from "../chrome-extension/modules/geographic.js";

describe("normalizeLocation", () => {
  it("normalizes Chinese cities", () => {
    assert.equal(normalizeLocation("Beijing"), "china");
    assert.equal(normalizeLocation("Shanghai, China"), "china");
    assert.equal(normalizeLocation("shenzhen"), "china");
  });

  it("normalizes Indian cities", () => {
    assert.equal(normalizeLocation("Bangalore"), "india");
    assert.equal(normalizeLocation("Mumbai, India"), "india");
  });

  it("normalizes US locations", () => {
    assert.equal(normalizeLocation("San Francisco, CA"), "usa");
    assert.equal(normalizeLocation("New York"), "usa");
    assert.equal(normalizeLocation("United States"), "usa");
  });

  it("returns raw value for unknown locations", () => {
    assert.equal(normalizeLocation("mars colony"), "mars colony");
  });
});

describe("analyzeGeographicClustering", () => {
  it("returns neutral for insufficient profiles", () => {
    const result = analyzeGeographicClustering([{ location: "NYC" }]);
    assert.equal(result.subscore, 0.5);
  });

  it("reports insufficient location data", () => {
    const profiles = Array.from({ length: 10 }, () => ({ location: "" }));
    const result = analyzeGeographicClustering(profiles);
    assert.equal(result.subscore, 0.5);
    assert.ok(result.signals[0].signal.includes("Insufficient"));
  });

  it("scores high for geographically diverse profiles", () => {
    const profiles = [
      { location: "San Francisco" },
      { location: "London" },
      { location: "Tokyo" },
      { location: "Berlin" },
      { location: "São Paulo" },
      { location: "Sydney" },
      { location: "Toronto" },
      { location: "Paris" },
    ];
    const result = analyzeGeographicClustering(profiles);
    assert.ok(result.subscore > 0.6);
    assert.ok(result.topPercent < 60);
  });

  it("flags extreme geographic concentration", () => {
    const profiles = [
      { location: "Beijing" },
      { location: "Shanghai" },
      { location: "Shenzhen" },
      { location: "Guangzhou" },
      { location: "Hangzhou" },
      { location: "Chengdu" },
      { location: "China" },
      { location: "London" },
    ];
    const result = analyzeGeographicClustering(profiles);
    assert.equal(result.topLocation, "china");
    assert.ok(result.topPercent > 70);
    assert.ok(result.subscore < 0.6);
    assert.equal(result.signals[0].severity, "high");
  });
});
