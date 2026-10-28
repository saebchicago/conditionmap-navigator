import { createFileRoute } from "@tanstack/react-router";
import { EVIDENCE_PACK } from "@/server/evidence-pack";
import { filterEligible, fallbackPoints, validateModelOutput, type BriefInput, type Card } from "@/lib/navigator";

// Public endpoint: no auth, stores nothing, returns only evidence-pack derived content.
const BASE = "https://api.tokenfactory.nebius.com/v1";
let cachedModel: string | null = null;
let cachedList: string[] = [];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function selectModel(key: string): Promise<string> {
  if (process.env["NEBIUS_MODEL"]) return process.env["NEBIUS_MODEL"];
  if (cachedModel) return cachedModel;
  const r = await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`models_list_failed_${r.status}`);
  const data = (await r.json()) as { data?: { id: string }[] };
  cachedList = (data.data ?? []).map((m) => m.id).filter((id) => /nemotron/i.test(id));
  const pick = cachedList.find((id) => /super/i.test(id)) ?? cachedList.find((id) => /nano/i.test(id)) ?? cachedList[0];
  if (!pick) throw new Error("no_nemotron_model");
  cachedModel = pick;
  return pick;
}

function buildPrompt(input: BriefInput, eligible: Card[]) {
  const cards = eligible.map(({ id, topic, guideline_says }) => ({ id, topic, guideline_says }));
  const system = `You help family caregivers prepare questions for a clinician visit. You only use the evidence cards given. Rules:
- Rank all eligible card IDs in relevance order, each once. The brief will use up to 3 distinct discussion topics. E2, E3, and E9 are one medicine class; keep at most one in the first 3 and rank other topics next.
- Heart failure type selected by the caregiver: ${input.hfType || "not given"}. If it is reduced EF, prefer E9 over E3; if mildly reduced or preserved EF, prefer E3 over E9.
- For each: "point" must be a short plain-language STATEMENT explaining why this topic matters for this situation, never a question (the question is shown separately). Use a 6th-8th grade reading level. "rationale" = one sentence on why it ranks here. Do not return a question field; the app uses the evidence card's question verbatim.
- Each point may use facts ONLY from that selected card's guideline_says and the caregiver's explicit inputs. Never borrow facts from another card. Do not infer the presence OR absence of unselected conditions. Do not invent numbers or medicine/class terms.
- Never assume relationships or gender. No mom, mother, dad, father, wife, husband, her, his, him, she, he, we, i, my, me, mine, our, or us. Say "the person you care for" or "they". Use a neutral, calm tone. Apply these rules to rationale too.
- Do not add drugs, doses, numbers, or claims not in the card. Never tell anyone to start, stop, or change a medicine. Explain why the topic matters without giving treatment instructions.
- Return exactly one JSON object with a "points" array. No markdown, <think> blocks, reasoning text, or text outside the JSON. Every entry must include an eligible card_id. Use this exact structure: {"points":[{"card_id":"E2","point":"...","rationale":"..."}]}`;
  const user = JSON.stringify({ caregiver_inputs: input, eligible_cards: cards });
  return { system, user };
}

export const Route = createFileRoute("/api/public/navigator-brief")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let body: { health?: unknown; conditions?: unknown; hfType?: unknown; medicines?: unknown; numbers?: unknown; worry?: unknown };
        try {
          body = await request.json();
        } catch {
          return json({ error: "invalid_json" }, 400);
        }
        const key = process.env["NEBIUS_API_KEY"];

        if (body.health) {
          if (!key) return json({ ok: false, error: "missing_api_key" });
          try {
            const model = await selectModel(key);
            return json({ ok: true, model, nemotron_models: cachedList, model_from_env: !!process.env["NEBIUS_MODEL"] });
          } catch (e) {
            return json({ ok: false, error: (e as Error).message });
          }
        }

        const input: BriefInput = {
          conditions: (Array.isArray(body.conditions) ? body.conditions : []).map(String).slice(0, 3) as BriefInput["conditions"],
          hfType: typeof body.hfType === "string" ? body.hfType.slice(0, 40) : undefined,
          medicines: (Array.isArray(body.medicines) ? body.medicines : []).map((m) => String(m).slice(0, 80)).slice(0, 30),
          numbers: typeof body.numbers === "object" && body.numbers ? (body.numbers as Record<string, string>) : {},
          worry: typeof body.worry === "string" ? body.worry.slice(0, 300) : "",
        };
        const eligible = filterEligible(EVIDENCE_PACK.cards as unknown as Card[], input.conditions, input.medicines);
        const eligible_ids = eligible.map((c) => c.id);
        if (!eligible.length) return json({ points: [], mode: "fallback", eligible_ids });
        const fallback = (error: string, extra: Record<string, unknown> = {}) =>
          json({ points: fallbackPoints(eligible, input.hfType), mode: "fallback", error, eligible_ids, ...extra });
        if (!key) return fallback("missing_api_key");

        const t0 = Date.now();
        try {
          const model = await selectModel(key);
          const { system, user } = buildPrompt(input, eligible);
          const r = await fetch(`${BASE}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
            body: JSON.stringify({
              model, temperature: 0.2, max_tokens: 2400,
              response_format: { type: "json_object" },
              ...(/nemotron/i.test(model) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
              messages: [{ role: "system", content: system }, { role: "user", content: user }],
            }),
            signal: AbortSignal.timeout(45000),
          });
          const latency_ms = Date.now() - t0;
          if (!r.ok) return fallback(`model_http_${r.status}`, { model, latency_ms });
          const data = (await r.json()) as { model?: string; choices?: { message?: { content?: string } }[] };
          const used = data.model ?? model;
          const points = validateModelOutput(data.choices?.[0]?.message?.content ?? "", eligible, input);
          if (!points) return fallback("model_output_invalid", { model: used, latency_ms });
          return json({ points, mode: "nemotron", model: used, latency_ms, eligible_ids });
        } catch (e) {
          const msg = (e as Error).name === "TimeoutError" ? "model_timeout" : "model_request_failed";
          return fallback(msg, { latency_ms: Date.now() - t0 });
        }
      },
    },
  },
});
