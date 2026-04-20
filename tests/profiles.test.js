import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasDefaultAvatar, analyzeProfileQuality } from "../chrome-extension/modules/profiles.js";

describe("hasDefaultAvatar", () => {
  it("returns true for null/empty", () => {
    assert.equal(hasDefaultAvatar(null), true);
    assert.equal(hasDefaultAvatar(""), true);
  });

  it("detects GitHub identicon URLs", () => {
    assert.equal(hasDefaultAvatar("https://avatars.githubusercontent.com/u/12345?v=4"), true);
  });

  it("returns false for custom avatar with size param", () => {
    assert.equal(hasDefaultAvatar("https://avatars.githubusercontent.com/u/12345?v=4&s=64"), false);
  });

  it("returns false for non-identicon URLs", () => {
    assert.equal(hasDefaultAvatar("https://example.com/avatar.png"), false);
  });
});

describe("analyzeProfileQuality", () => {
  it("returns neutral for empty profiles", () => {
    const result = analyzeProfileQuality([]);
    assert.equal(result.subscore, 0.5);
    assert.equal(result.sampleSize, 0);
  });

  it("returns neutral for null", () => {
    const result = analyzeProfileQuality(null);
    assert.equal(result.subscore, 0.5);
  });

  it("scores high for healthy profiles", () => {
    const profiles = Array.from({ length: 20 }, (_, i) => ({
      public_repos: 10 + i,
      followers: 5 + i,
      following: 3,
      public_gists: 1,
      bio: "I write code",
      avatar_url: `https://example.com/avatar${i}.png`,
    }));
    const result = analyzeProfileQuality(profiles);
    assert.ok(result.subscore > 0.8);
    assert.equal(result.sampleSize, 20);
    assert.equal(result.zeroReposPercent, 0);
    assert.equal(result.ghostPercent, 0);
  });

  it("flags high zero-repos percentage", () => {
    const profiles = Array.from({ length: 20 }, () => ({
      public_repos: 0,
      followers: 5,
      following: 3,
      public_gists: 1,
      bio: "test",
      avatar_url: "https://example.com/a.png",
    }));
    const result = analyzeProfileQuality(profiles);
    assert.equal(result.zeroReposPercent, 100);
    const signal = result.signals.find((s) => s.signal.includes("0 repos"));
    assert.equal(signal.severity, "high");
  });

  it("detects ghost accounts", () => {
    const profiles = Array.from({ length: 10 }, (_, i) => ({
      public_repos: 0,
      followers: 0,
      following: 0,
      public_gists: 0,
      bio: "",
      avatar_url: `https://avatars.githubusercontent.com/u/${i}?v=4`,
    }));
    const result = analyzeProfileQuality(profiles);
    assert.equal(result.ghostPercent, 100);
    assert.ok(result.subscore < 0.3);
  });

  it("handles mixed profiles", () => {
    const healthy = Array.from({ length: 15 }, (_, i) => ({
      public_repos: 10,
      followers: 5,
      following: 3,
      public_gists: 1,
      bio: "dev",
      avatar_url: "https://example.com/a.png",
    }));
    const suspicious = Array.from({ length: 5 }, (_, i) => ({
      public_repos: 0,
      followers: 0,
      following: 0,
      public_gists: 0,
      bio: "",
      avatar_url: `https://avatars.githubusercontent.com/u/${i}?v=4`,
    }));
    const result = analyzeProfileQuality([...healthy, ...suspicious]);
    assert.equal(result.sampleSize, 20);
    assert.equal(result.ghostPercent, 25);
    // Score should be middle ground
    assert.ok(result.subscore > 0.2);
    assert.ok(result.subscore < 0.9);
  });
});
