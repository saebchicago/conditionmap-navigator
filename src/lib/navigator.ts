// Deterministic pipeline steps shared by the server route and the browser fallback.
export type ConditionKey = "heart_failure" | "type_2_diabetes" | "ckd";

export interface Card {
  id: string;
  requires: readonly string[];
  medication_trigger?: readonly string[];
  topic: string;
  guideline_says: string;
  question_for_clinician: string;
  source: string;
  label: string;
}

export interface Source {
  title: string;
  authors: string;
  journal: string;
  doi: string;
}

export interface Pack {
  cards: readonly Card[];
  sources: Record<string, Source>;
}

export interface BriefInput {
  conditions: ConditionKey[];
  hfType?: string | undefined;
  medicines: string[];
  numbers: Record<string, string>;
  worry: string;
}

export interface BriefPoint {
  card_id: string;
  point: string;
  question: string;
  rationale: string;
  standardized?: boolean;
  supporting_card_ids?: string[];
}

export interface BriefResult {
  points: BriefPoint[];
  mode: "nemotron" | "fallback";
  model?: string;
  latency_ms?: number;
  error?: string;
}

/** Step A: a card is eligible if all required conditions are selected and any medication trigger matches. */
export function filterEligible(cards: readonly Card[], conditions: string[], medicines: string[]): Card[] {
  const meds = medicines.map((m) => m.toLowerCase());
  return cards.filter((c) => {
    if (!c.requires.every((r) => conditions.includes(r))) return false;
    if (!c.medication_trigger || c.medication_trigger.length === 0) return true;
    return c.medication_trigger.some((t) => meds.some((m) => m.includes(t.toLowerCase())));
  });
}

/** Order by heart failure type: reduced EF puts E9 before E3; mildly reduced or preserved puts E3 before E9. */
export function orderByHfType(eligible: Card[], hfType?: string): Card[] {
  const t = (hfType ?? "").toLowerCase();
  const first = t.startsWith("reduced") ? "E9" : t.startsWith("mildly") || t.startsWith("preserved") ? "E3" : null;
  if (!first) return eligible;
  const other = first === "E9" ? "E3" : "E9";
  const a = eligible.findIndex((c) => c.id === first);
  const b = eligible.findIndex((c) => c.id === other);
  if (a < 0 || b < 0 || a < b) return eligible;
  const out = [...eligible];
  const preferred = out[a];
  const secondary = out[b];
  if (!preferred || !secondary) return eligible;
  [out[a], out[b]] = [secondary, preferred];
  return out;
}

export const MEDICINE_TERMS = ["metformin", "sglt2", "empagliflozin", "dapagliflozin", "canagliflozin", "finerenone", "glp-1", "semaglutide", "liraglutide", "dulaglutide", "tirzepatide", "pioglitazone", "insulin", "ace inhibitor", "arb", "lisinopril", "losartan", "sacubitril", "entresto", "spironolactone", "eplerenone", "beta blocker", "furosemide", "diuretic"] as const;
const SGLT2_IDS = new Set(["E2", "E3", "E9"]);
const RELATIONSHIPS = /\b(mom|mother|dad|father|wife|husband|her|his|him|she|he|we|i|my|me|mine|our|us|loved\s+one)\b/i;
const normalize = (text: string) => text.toLowerCase().replace(/[‐-―]/g, "-");
const numericTokens = (text: string) => text.match(/\d+(?:,\d{3})*(?:\.\d+)?/g)?.map((v) => v.replace(/,/g, "")) ?? [];
const containsTerm = (text: string, term: string) => new RegExp(`\\b${term.replace(/ /g, "\\s+")}s?\\b`, "i").test(normalize(text));

export function standardPoint(card: Card): string {
  const firstSentence = card.guideline_says.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? card.guideline_says;
  return `${card.topic}: ${firstSentence}`;
}

/** Exact lexical guard, not a claim that all generated semantics are verified. */
export function checkPoint(point: string, card: Card, input?: BriefInput): { point: string; standardized: boolean } {
  const explicit = input ? [...input.conditions, input.hfType ?? "", ...input.medicines, ...Object.values(input.numbers), input.worry].join(" ") : "";
  const allowedNumbers = new Set(numericTokens(`${card.guideline_says} ${explicit}`));
  const allowedMedicines = `${card.guideline_says} ${(input?.medicines ?? []).join(" ")}`;
  const invalid = !point.trim() || RELATIONSHIPS.test(point)
    || numericTokens(point).some((n) => !allowedNumbers.has(n))
    || MEDICINE_TERMS.some((term) => containsTerm(point, term) && !containsTerm(allowedMedicines, term));
  return invalid ? { point: standardPoint(card), standardized: true } : { point, standardized: false };
}

/** Keep one SGLT2 card, use remaining model ranks, then fill from pack order. */
function diversePoints(ranked: BriefPoint[], eligible: Card[]): BriefPoint[] {
  const result: BriefPoint[] = [];
  const seen = new Set<string>();
  let keptSglt2 = false;
  const backfill = eligible.map((c): BriefPoint => ({ card_id: c.id, point: standardPoint(c), question: c.question_for_clinician, rationale: "Selected by rule to fill the next eligible discussion topic.", standardized: true }));
  for (const point of [...ranked, ...backfill]) {
    if (seen.has(point.card_id)) continue;
    seen.add(point.card_id);
    const sglt2 = SGLT2_IDS.has(point.card_id);
    if (sglt2 && keptSglt2) continue;
    if (sglt2) keptSglt2 = true;
    result.push({ ...point, supporting_card_ids: sglt2 ? eligible.filter((c) => SGLT2_IDS.has(c.id) && c.id !== point.card_id).map((c) => c.id) : [] });
    if (result.length === 3) break;
  }
  return result;
}

/** Rule-based selection with diversity and verbatim evidence questions. */
export function fallbackPoints(eligible: Card[], hfType?: string): BriefPoint[] {
  return diversePoints(orderByHfType(eligible, hfType).map((c) => ({
    card_id: c.id,
    point: standardPoint(c),
    question: c.question_for_clinician,
    rationale: "Selected by rule: eligible for the selected conditions and medicines, in evidence pack order.",
    standardized: false,
  })), eligible);
}

export function stripThink(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "").trim();
}

/** Step C: parse model output, keep only eligible card ids, dedupe, cap at 3. Returns null if unusable. */
export function validateModelOutput(raw: string, eligible: Card[], input?: BriefInput): BriefPoint[] | null {
  const text = stripThink(raw).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (/<think>/i.test(text) || text.startsWith("[")) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const pts = (parsed as { points?: unknown }).points;
  if (!Array.isArray(pts)) return null;
  const ids = new Map(eligible.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: BriefPoint[] = [];
  for (const p of pts) {
    if (!p || typeof p !== "object" || Array.isArray(p)) continue;
    if (typeof (p as BriefPoint).card_id !== "string") continue;
    const id = (p as BriefPoint).card_id.trim();
    const card = ids.get(id);
    if (!card || seen.has(id)) continue;
    seen.add(id);
    const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    out.push({
      card_id: id,
      ...checkPoint(s((p as BriefPoint).point), card, input),
      question: card.question_for_clinician,
      rationale: s((p as BriefPoint).rationale),
    });
  }
  return out.length ? diversePoints(out, eligible) : null;
}
