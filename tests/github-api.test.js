import { describe, it, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { githubFetch, resetApiState } from "../chrome-extension/modules/github-api.js";

describe("githubFetch", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    resetApiState();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(responses) {
    let callIndex = 0;
    globalThis.fetch = async () => {
      const resp = responses[Math.min(callIndex, responses.length - 1)];
      callIndex++;
      if (resp.networkError) throw new Error("fetch failed");
      return {
        ok: resp.ok,
        status: resp.status || (resp.ok ? 200 : 500),
        statusText: resp.statusText || "",
        headers: new Map(Object.entries(resp.headers || {})),
        json: async () => resp.body,
      };
    };
    return () => callIndex;
  }

  it("returns JSON on success", async () => {
    mockFetch([{ ok: true, body: { id: 1 }, headers: {} }]);
    const result = await githubFetch("https://api.github.com/test", null);
    assert.deepEqual(result, { id: 1 });
  });

  it("sets auth header when token provided", async () => {
    let capturedHeaders;
    globalThis.fetch = async (url, opts) => {
      capturedHeaders = opts.headers;
      return {
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({}),
      };
    };
    await githubFetch("https://api.github.com/test", "my-token");
    assert.equal(capturedHeaders.Authorization, "Bearer my-token");
  });

  it("throws RATE_LIMITED on 403", async () => {
    mockFetch([{
      ok: false,
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "9999" },
    }]);
    await assert.rejects(
      () => githubFetch("https://api.github.com/test", null),
      (err) => err.message.startsWith("RATE_LIMITED")
    );
  });

  it("throws RATE_LIMITED on 429", async () => {
    mockFetch([{
      ok: false,
      status: 429,
      headers: { "x-ratelimit-reset": "1234" },
    }]);
    await assert.rejects(
      () => githubFetch("https://api.github.com/test", null),
      (err) => err.message === "RATE_LIMITED:1234"
    );
  });

  it("retries on 500 and succeeds", async () => {
    const getCallCount = mockFetch([
      { ok: false, status: 500, statusText: "Internal Server Error", headers: {} },
      { ok: true, body: { recovered: true }, headers: {} },
    ]);
    const result = await githubFetch("https://api.github.com/test", null);
    assert.deepEqual(result, { recovered: true });
    assert.ok(getCallCount() >= 2);
  });

  it("retries on network error and succeeds", async () => {
    const getCallCount = mockFetch([
      { networkError: true },
      { ok: true, body: { recovered: true }, headers: {} },
    ]);
    const result = await githubFetch("https://api.github.com/test", null);
    assert.deepEqual(result, { recovered: true });
    assert.ok(getCallCount() >= 2);
  });

  it("does not retry rate limits", async () => {
    const getCallCount = mockFetch([{
      ok: false,
      status: 429,
      headers: { "x-ratelimit-reset": "1234" },
    }]);
    await assert.rejects(
      () => githubFetch("https://api.github.com/test", null),
      (err) => err.message.startsWith("RATE_LIMITED")
    );
    assert.equal(getCallCount(), 1);
  });

  it("throws after max retries on persistent 500", async () => {
    mockFetch([
      { ok: false, status: 500, statusText: "Error", headers: {} },
      { ok: false, status: 500, statusText: "Error", headers: {} },
      { ok: false, status: 500, statusText: "Error", headers: {} },
      { ok: false, status: 500, statusText: "Error", headers: {} },
    ]);
    await assert.rejects(
      () => githubFetch("https://api.github.com/test", null),
      (err) => err.message.includes("500")
    );
  });

  it("throws on 404 without retry", async () => {
    const getCallCount = mockFetch([{
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: {},
    }]);
    await assert.rejects(
      () => githubFetch("https://api.github.com/test", null),
      (err) => err.message.includes("404")
    );
    assert.equal(getCallCount(), 1);
  });
});
