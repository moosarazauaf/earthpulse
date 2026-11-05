import { afterEach, describe, expect, it, vi } from "vitest";

import worker, { MODELS, validate } from "../src/index.js";

const ORIGIN = "https://moosarazauaf.github.io";
const post = (body, origin = ORIGIN) => new Request("https://proxy.example/", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
const env = { OPENROUTER_API_KEY: "test-key" };
const ok = { messages: [{ role: "user", content: "floods in Layyah" }], tools: [{ type: "function", function: { name: "plan_analysis", parameters: {} } }] };

afterEach(() => vi.unstubAllGlobals());

describe("assistant proxy", () => {
  it("refuses other origins and answers the preflight for its own", async () => {
    expect((await worker.fetch(post(ok, "https://evil.example"), env)).status).toBe(403);
    const pre = await worker.fetch(new Request("https://proxy.example/", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env);
    expect(pre.status).toBe(204);
    expect(pre.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("checks the request shape", () => {
    expect(validate({ messages: [] })).toMatch(/messages must be/);
    expect(validate({ messages: [{ role: "admin", content: "x" }] })).toMatch(/role/);
    expect(validate({ messages: [{ role: "user", content: "x".repeat(20_001) }] })).toMatch(/content/);
    expect(validate({ ...ok, tools: Array(9).fill(ok.tools[0]) })).toMatch(/eight tools/);
    // Unknown fields such as a chosen model are dropped, so callers cannot pick a paid model.
    const clean = validate({ ...ok, model: "openai/gpt-5", messages: [{ role: "user", content: "hi", extra: 1 }] });
    expect(clean).toEqual({ messages: [{ role: "user", content: "hi" }], tools: ok.tools });
  });

  it("forwards to free models with the key and returns only the message", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: MODELS[0], usage: { cost: 0 }, choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "plan_analysis", arguments: "{}" } }] } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const res = await worker.fetch(post({ ...ok, model: "openai/gpt-5" }), env);
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(init.body);
    expect(sent.models).toEqual(MODELS);
    expect(sent.model).toBeUndefined();
    expect(init.headers.Authorization).toBe("Bearer test-key");
    const body = await res.json();
    expect(body).toEqual({ model: MODELS[0], choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "plan_analysis", arguments: "{}" } }] } }] });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
  });

  it("does not pass upstream error bodies through, and rate-limits", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"key sk-or-123 has no credits"}', { status: 402 })));
    const res = await worker.fetch(post(ok), env);
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("sk-or");
    const limited = await worker.fetch(post(ok), { ...env, LIMITER: { limit: async () => ({ success: false }) } });
    expect(limited.status).toBe(429);
    expect((await worker.fetch(post("{not json"), env)).status).toBe(400);
    expect((await worker.fetch(post(ok), {})).status).toBe(503);
  });
});
