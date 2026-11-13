/**
 * Earthsift assistant proxy (Cloudflare Worker).
 *
 * Holds the OpenRouter key as a Worker secret and forwards chat requests from
 * the Earthsift site to free models only. It answers browsers on the
 * Earthsift origins, checks the shape and size of every request, limits each
 * visitor's rate, and returns only the model's message. Nothing is logged.
 */

/** Free models with tool calling, tried in order (OpenRouter falls back down the list). */
export const MODELS = ["nvidia/nemotron-3.5-lightning:free", "nvidia/nemotron-3-ultra-550b-a55b:free", "google/gemma-4-31b-it:free"];
export const ORIGINS = ["https://moosarazauaf.github.io", "http://localhost:5173", "http://localhost:4173"];
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const MAX_BODY = 120_000;
const MAX_MESSAGES = 40;
const MAX_TEXT = 20_000;
// The app sends every tool it has (15 in 0.2.0-alpha.38); room to grow without a redeploy.
const MAX_TOOLS = 24;
const ROLES = new Set(["system", "user", "assistant", "tool"]);

export function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const isText = (v, max) => typeof v === "string" && v.length <= max;

/** The request body checked field by field: an error message, or the parts forwarded. */
export function validate(body) {
  if (!body || typeof body !== "object") return "Body must be a JSON object.";
  const { messages, tools } = body;
  if (!Array.isArray(messages) || !messages.length || messages.length > MAX_MESSAGES) return `messages must be a list of 1 to ${MAX_MESSAGES}.`;
  for (const m of messages) {
    if (!m || typeof m !== "object" || !ROLES.has(m.role)) return "Each message needs a role: system, user, assistant or tool.";
    if (!(m.content === null || m.content === undefined || isText(m.content, MAX_TEXT))) return "Message content must be text.";
    if (m.tool_call_id !== undefined && !isText(m.tool_call_id, 100)) return "tool_call_id must be short text.";
    if (m.tool_calls !== undefined) {
      if (!Array.isArray(m.tool_calls) || m.tool_calls.length > 3) return "At most three tool calls per message.";
      for (const c of m.tool_calls) {
        if (!c?.function || !isText(c.function.name, 64) || !isText(c.function.arguments ?? "", MAX_TEXT) || !isText(c.id ?? "", 100)) return "Malformed tool call.";
      }
    }
  }
  if (tools !== undefined) {
    if (!Array.isArray(tools) || tools.length > MAX_TOOLS) return `At most ${MAX_TOOLS} tools.`;
    if (!tools.every((t) => t?.type === "function" && isText(t.function?.name, 64))) return "Tools must be functions with a name.";
  }
  const clean = messages.map((m) => {
    const out = { role: m.role, content: m.content ?? null };
    if (m.tool_calls) out.tool_calls = m.tool_calls.map((c) => ({ id: c.id, type: "function", function: { name: c.function.name, arguments: c.function.arguments ?? "" } }));
    if (m.tool_call_id) out.tool_call_id = m.tool_call_id;
    return out;
  });
  return { messages: clean, tools };
}

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } });

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") ?? "";
    if (!ORIGINS.includes(origin)) return new Response("Forbidden", { status: 403 });
    const cors = corsHeaders(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "Use POST." }, 405, cors);
    if (!env.OPENROUTER_API_KEY) return json({ error: "The assistant is not configured." }, 503, cors);

    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") ?? "unknown" });
      if (!success) return json({ error: "Too many requests; try again in a minute." }, 429, cors);
    }
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: "Request too large." }, 413, cors);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "Body must be JSON." }, 400, cors); }
    const checked = validate(body);
    if (typeof checked === "string") return json({ error: checked }, 400, cors);

    const upstream = await fetch(OPENROUTER, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://moosarazauaf.github.io/earthsift/",
        "X-Title": "Earthsift",
      },
      body: JSON.stringify({ models: MODELS, messages: checked.messages, tools: checked.tools, tool_choice: checked.tools ? "auto" : undefined, max_tokens: 1024, temperature: 0.2 }),
    });
    if (!upstream.ok) {
      // Pass on whether to retry, never the upstream body (it can echo account details).
      return json({ error: upstream.status === 429 ? "The free models are busy; try again shortly." : "The model service failed." }, upstream.status === 429 ? 429 : 502, cors);
    }
    const data = await upstream.json();
    const message = data?.choices?.[0]?.message ?? {};
    return json({ model: data?.model ?? null, choices: [{ message: { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls } }] }, 200, cors);
  },
};
