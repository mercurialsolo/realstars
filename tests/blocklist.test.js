import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeBlocklist } from "../chrome-extension/modules/blocklist.js";

describe("analyzeBlocklist", () => {
  it("returns neutral for empty profiles", () => {
    const result = analyzeBlocklist([]);
    assert.equal(result.subscore, 0.5);
    assert.equal(result.matchCount, 0);
  });

  it("returns neutral for null", () => {
    const result = analyzeBlocklist(null);
    assert.equal(result.subscore, 0.5);
  });

  it("scores high when no matches found", () => {
    const profiles = [
      { login: "alice" },
      { login: "bob" },
      { login: "charlie" },
    ];
    const result = analyzeBlocklist(profiles);
    assert.equal(result.matchCount, 0);
    assert.equal(result.subscore, 1.0);
    assert.equal(result.signals[0].severity, "ok");
  });

  it("detects bot-pattern usernames", () => {
    const profiles = [
      { login: "user123" },
      { login: "bot456" },
      { login: "star789" },
      { login: "alice" },
    ];
    const result = analyzeBlocklist(profiles);
    assert.equal(result.matchCount, 3);
    assert.ok(result.subscore < 0.5);
  });

  it("detects ghost account", () => {
    const profiles = [
      { login: "ghost" },
      { login: "alice" },
      { login: "bob" },
    ];
    const result = analyzeBlocklist(profiles);
    assert.equal(result.matchCount, 1);
    assert.ok(result.matched.includes("ghost"));
  });

  it("matches against provided blocklist", () => {
    const profiles = [
      { login: "knownbot" },
      { login: "alice" },
      { login: "bob" },
    ];
    const result = analyzeBlocklist(profiles, ["knownbot"]);
    assert.equal(result.matchCount, 1);
    assert.ok(result.matched.includes("knownbot"));
  });

  it("matches exact usernames and regex patterns from bundled blocklist shape", () => {
    const profiles = [
      { login: "KnownBot" },
      { login: "farm-12345" },
      { login: "alice" },
    ];
    const blocklist = {
      exactUsernames: ["knownbot"],
      usernamePatterns: ["^farm-[0-9]+$"],
    };
    const result = analyzeBlocklist(profiles, blocklist);
    assert.equal(result.matchCount, 2);
    assert.ok(result.matched.includes("knownbot"));
    assert.ok(result.matched.includes("farm-12345"));
  });

  it("flags high percentage (>10%)", () => {
    const profiles = [
      { login: "user111" },
      { login: "user222" },
      { login: "bot333" },
      { login: "star444" },
      { login: "alice" },
      { login: "bob" },
      { login: "charlie" },
      { login: "diana" },
      { login: "ed" },
      { login: "fiona" },
    ];
    const result = analyzeBlocklist(profiles);
    assert.ok(result.matchCount >= 4);
    assert.equal(result.signals[0].severity, "high");
  });
});
