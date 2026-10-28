import type { Config } from "@netlify/functions";
import {
  InputError,
  draft,
  isTrusted,
  plan,
  retrieve,
  validateIntake,
  verify,
  type ChatFn,
  type DraftPoint,
  type SearchFn,
  type Source,
} from "./lib/pipeline.ts";

// One endpoint, one step per call. The browser orchestrates the steps so each
// request stays short and the agent trace can render live.

// Prefer Netlify.env (Netlify runtime); fall back to process.env for local tests.
const env = (k: string): string | undefined =>
  (globalThis as { Netlify?: { env: { get(k: string): string | undefined } } }).Netlify?.env.get(k) ?? process.env[k];

const BASE_URL = (env("NEBIUS_BASE_URL") || "https://api.tokenfactory.nebius.com/v1").replace(/\/+$/, "");
const MODEL_FAST = env("NEBIUS_MODEL_FAST") || "nvidia/nemotron-3-super-120b-a12b";
const MODEL_DRAFT = env("NEBIUS_MODEL_DRAFT") || "nvidia/nemotron-3-super-120b-a12b";
const TIMEOUT_MS = Number(env("STEP_TIMEOUT_MS") || 50000);

const chat: ChatFn = async ({ model, messages, maxTokens }) => {
  const key = env("NEBIUS_API_KEY");
  if (!key) throw new ConfigError("NEBIUS_API_KEY is not set.");
  const res = await fetchWithTimeout(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model === "fast" ? MODEL_FAST : MODEL_DRAFT,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new UpstreamError(`Token Factory returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content.trim()) throw new UpstreamError("Model returned an empty answer. Try raising max tokens or switching models.");
  return content;
};

const search: SearchFn = async (query, domains) => {
  const key = env("TAVILY_API_KEY");
  if (!key) throw new ConfigError("TAVILY_API_KEY is not set.");
  const res = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      max_results: 4,
      include_domains: domains,
      include_answer: false,
    }),
  });
  if (!res.ok) throw new UpstreamError(`Tavily returned ${res.status}`);
  const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return (data.results ?? []).map((r) => ({ title: r.title ?? "", url: r.url ?? "", content: r.content ?? "" }));
};

class ConfigError extends Error {}
class UpstreamError extends Error {}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new UpstreamError("Upstream call timed out.");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export default async (req: Request): Promise<Response> => {
  if (req.method === "GET") return health();
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const started = Date.now();
  try {
    const intake = validateIntake(body.intake);
    switch (body.step) {
      case "plan": {
        const queries = await plan(intake, chat);
        return json({ queries, ms: Date.now() - started, model: MODEL_FAST });
      }
      case "retrieve": {
        const queries = Array.isArray(body.queries)
          ? body.queries.filter((q): q is string => typeof q === "string").slice(0, 4)
          : [];
        const sources = await retrieve(queries, search);
        return json({ sources, ms: Date.now() - started });
      }
      case "draft": {
        const sources = sanitizeSources(body.sources);
        const points = await draft(intake, sources, chat);
        return json({ points, ms: Date.now() - started, model: MODEL_DRAFT });
      }
      case "verify": {
        const sources = sanitizeSources(body.sources);
        const points = sanitizePoints(body.points, sources);
        const result = await verify(points, sources, chat);
        return json({ ...result, ms: Date.now() - started, model: MODEL_FAST });
      }
      default:
        return json({ error: "Unknown step." }, 400);
    }
  } catch (e) {
    if (e instanceof InputError) return json({ error: e.message }, 400);
    if (e instanceof ConfigError) return json({ error: e.message }, 500);
    if (e instanceof UpstreamError) return json({ error: e.message }, 502);
    return json({ error: (e as Error).message || "Unexpected error." }, 500);
  }
};

// Sources and points round-trip through the browser, so re-check them server side.
function sanitizeSources(raw: unknown): Source[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Source[] = [];
  for (const s of raw.slice(0, 10)) {
    if (!s || typeof s !== "object") continue;
    const o = s as Record<string, unknown>;
    const id = String(o.id ?? "");
    const url = String(o.url ?? "").slice(0, 500);
    const domain = String(o.domain ?? "").slice(0, 100);
    if (!/^S\d{1,2}$/.test(id) || seen.has(id) || !url.startsWith("https://") || !isTrusted(domain)) continue;
    seen.add(id);
    out.push({
      id,
      title: String(o.title ?? "").slice(0, 160),
      url,
      domain,
      snippet: String(o.snippet ?? "").slice(0, 900),
    });
  }
  return out;
}

function sanitizePoints(raw: unknown, sources: Source[]): DraftPoint[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set(sources.map((s) => s.id));
  return raw.slice(0, 3).flatMap((p) => {
    if (!p || typeof p !== "object") return [];
    const o = p as Record<string, unknown>;
    const sourceIds = Array.isArray(o.sourceIds) ? o.sourceIds.filter((x): x is string => typeof x === "string" && ids.has(x)) : [];
    const title = String(o.title ?? "").slice(0, 90);
    const why = String(o.why ?? "").slice(0, 400);
    const ask = String(o.ask ?? "").slice(0, 300);
    return title && why && ask && sourceIds.length ? [{ title, why, ask, sourceIds }] : [];
  });
}

async function health(): Promise<Response> {
  const key = env("NEBIUS_API_KEY");
  const status: Record<string, unknown> = {
    nebiusKey: Boolean(key),
    tavilyKey: Boolean(env("TAVILY_API_KEY")),
    modelFast: MODEL_FAST,
    modelDraft: MODEL_DRAFT,
  };
  if (key) {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/models`, { headers: { Authorization: `Bearer ${key}` } });
      const data = (await res.json()) as { data?: { id: string }[] };
      const ids = (data.data ?? []).map((m) => m.id);
      status.nemotronModelsAvailable = ids.filter((id) => /nemotron/i.test(id));
      status.modelFastFound = ids.includes(MODEL_FAST);
      status.modelDraftFound = ids.includes(MODEL_DRAFT);
    } catch (e) {
      status.modelsError = (e as Error).message;
    }
  }
  return json(status);
}

export const config: Config = { path: "/api/navigator" };
