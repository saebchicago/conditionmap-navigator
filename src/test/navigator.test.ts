import { describe, it, expect } from "vitest";
import pack from "@/data/evidence-pack.json";
import { EVIDENCE_PACK } from "@/server/evidence-pack";
import { filterEligible, validateModelOutput, fallbackPoints, checkPoint, standardPoint, MEDICINE_TERMS, type BriefInput, type Card } from "@/lib/navigator";

const cards = pack.cards as Card[];

describe("evidence pipeline", () => {
  it("server copy matches the JSON pack", () => {
    expect(JSON.parse(JSON.stringify(EVIDENCE_PACK))).toEqual(pack);
  });
  it("metformin card needs diabetes, CKD and metformin", () => {
    expect(filterEligible(cards, ["type_2_diabetes", "ckd"], []).map((c) => c.id)).not.toContain("E4");
    expect(filterEligible(cards, ["type_2_diabetes", "ckd"], ["Metformin 500mg"]).map((c) => c.id)).toContain("E4");
  });
  it("heart failure alone yields E3 and E9", () => {
    expect(filterEligible(cards, ["heart_failure"], []).map((c) => c.id)).toEqual(["E3", "E9"]);
  });
  it("reduced EF puts E9 before E3 in fallback", () => {
    const el = filterEligible(cards, ["heart_failure"], []);
    expect(fallbackPoints(el, "Reduced EF").map((p) => p.card_id)).toEqual(["E9"]);
    expect(fallbackPoints(el, "Reduced EF")[0]?.supporting_card_ids).toEqual(["E3"]);
  });
  it("mildly reduced or preserved EF puts E3 before E9", () => {
    const el = filterEligible(cards, ["heart_failure"], []);
    expect(fallbackPoints(el, "Mildly reduced EF").map((p) => p.card_id)).toEqual(["E3"]);
    expect(fallbackPoints(el, "Preserved EF").map((p) => p.card_id)).toEqual(["E3"]);
  });
  it("validator drops ineligible ids and caps at 3", () => {
    const el = filterEligible(cards, ["type_2_diabetes", "ckd"], []);
    const raw = `<think>x</think>{"points":[{"card_id":"E9","point":"a"},{"card_id":"E1","point":"a"},{"card_id":"E2","point":"b"},{"card_id":"E5","point":"c"},{"card_id":"E6","point":"d"}]}`;
    expect(validateModelOutput(raw, el)?.map((p) => p.card_id)).toEqual(["E1", "E2", "E5"]);
  });
  it("invalid output returns null and fallback uses pack order", () => {
    const el = filterEligible(cards, ["type_2_diabetes", "ckd"], []);
    expect(validateModelOutput("not json", el)).toBeNull();
    expect(fallbackPoints(el).map((p) => p.card_id)).toEqual(["E1", "E2", "E5"]);
  });
  it("accepts JSON wrapped in completed thinking blocks and markdown", () => {
    const el = filterEligible(cards, ["heart_failure"], []);
    expect(validateModelOutput('<think>reasoning</think>```json\n{"points":[{"card_id":"E9","point":"Discuss treatment","question":"Is it appropriate?"}]}\n```', el)?.map((p) => p.card_id)).toEqual(["E9"]);
  });
  it("rejects truncated reasoning and non-object output", () => {
    const el = filterEligible(cards, ["heart_failure"], []);
    expect(validateModelOutput('<think>unfinished reasoning', el)).toBeNull();
    expect(validateModelOutput('[{"points":[{"card_id":"E9"}]}]', el)).toBeNull();
    expect(validateModelOutput('{"points":[{"card_id":9}]}', el)).toBeNull();
  });
  it("deduplicates valid IDs and rejects an entirely ineligible reply", () => {
    const el = filterEligible(cards, ["heart_failure"], []);
    expect(validateModelOutput('{"points":[{"card_id":" E9 "},{"card_id":"E9"},{"card_id":"E3"}]}', el)?.map((p) => p.card_id)).toEqual(["E9"]);
    expect(validateModelOutput('{"points":[{"card_id":"E4"},{"card_id":"invented"}]}', el)).toBeNull();
  });
});

// Synthetic caregiver inputs used only to exercise output-quality rules.
const input: BriefInput = { conditions: ["heart_failure", "type_2_diabetes", "ckd"], hfType: "Preserved EF", medicines: ["metformin", "lisinopril", "furosemide"], numbers: { egfr: "38", bp: "142/86" }, worry: "Kidney safety" };
const card = cards.find((c) => c.id === "E4");
if (!card) throw new Error("Missing evidence card E4");

describe("point fidelity", () => {
  it("ignores model questions and uses evidence questions verbatim", () => {
    const points = validateModelOutput('{"points":[{"card_id":"E4","point":"Discuss metformin safety.","question":"typo or drift"}]}', filterEligible(cards, input.conditions, input.medicines), input);
    expect(points?.[0]?.question).toBe(card.question_for_clinician);
  });
  it("allows numbers in the selected guideline or explicit inputs", () => {
    expect(checkPoint("Discuss metformin at eGFR 38 and the guideline threshold 30.", card, input).standardized).toBe(false);
    expect(checkPoint("Discuss the blood pressure reading 142/86.", card, input).standardized).toBe(false);
    expect(checkPoint("Discuss the guideline dose of 1,000 mg.", card, input).standardized).toBe(false);
  });
  it("replaces an unsupported number with exactly the first guideline sentence", () => {
    expect(checkPoint("Discuss eGFR 39.", card, input)).toEqual({ point: "Metformin and kidney function: Metformin is recommended in type 2 diabetes with CKD when eGFR is at least 30.", standardized: true });
    expect(checkPoint("Discuss eGFR 3.8.", card, input).standardized).toBe(true);
  });
  it.each(MEDICINE_TERMS)("rejects unsupported medicine/class term %s", (term) => {
    const neutral: Card = { ...card, topic: "Screening", guideline_says: "Ask about screening." };
    expect(checkPoint(`Discuss ${term}.`, neutral).standardized).toBe(true);
  });
  it("allows medicines in the selected guideline or medicine list only", () => {
    expect(checkPoint("Discuss metformin and lisinopril.", card, input).standardized).toBe(false);
    expect(checkPoint("Discuss SGLT2 inhibitors.", card, input).standardized).toBe(true);
    expect(checkPoint("Discuss semaglutide.", card, { ...input, worry: "semaglutide" }).standardized).toBe(true);
    expect(checkPoint("Discuss GLP–1 receptor agonists.", card, { ...input, medicines: ["GLP-1"] }).standardized).toBe(false);
  });
  it.each(["mom", "mother", "dad", "father", "wife", "husband", "her", "his", "him", "she", "he"])("rejects relationship word %s", (word) => {
    expect(checkPoint(`Discuss ${word}'s kidney safety.`, card, input).standardized).toBe(true);
  });
  it("allows neutral wording without substring false positives", () => {
    expect(checkPoint("They can ask about the person you care for and their therapy.", card, input).standardized).toBe(false);
  });
  it("enforces no we and no assumed loved-one relationship", () => {
    expect(checkPoint("Can we discuss kidney safety?", card, input).standardized).toBe(true);
    expect(checkPoint("Discuss your loved one's eGFR of 38.", card, input).standardized).toBe(true);
  });
  it.each(["i", "my", "me", "mine", "our", "us"])("standardizes first-person word %s", (word) => {
    expect(checkPoint(`Discuss ${word} and kidney safety.`, card, input)).toEqual({ point: standardPoint(card), standardized: true });
  });
  it("allows dose or dosing only when the selected guideline mentions dose", () => {
    expect(checkPoint("Ask whether the metformin dose needs to change.", card, input).standardized).toBe(false);
    expect(checkPoint("Ask about metformin dosing at this eGFR.", card, input).standardized).toBe(false);
    const noDose: Card = { ...card, topic: "Screening", guideline_says: "Ask about screening." };
    expect(checkPoint("Ask whether the dose needs to change.", noDose)).toEqual({ point: standardPoint(noDose), standardized: true });
    expect(checkPoint("Ask about DOSING.", noDose).standardized).toBe(true);
    expect(checkPoint("Ask about the doses.", noDose).standardized).toBe(true);
    expect(checkPoint("Ask about the dosage form.", noDose).standardized).toBe(false);
  });
  it("first-sentence extraction preserves decimals", () => {
    expect(standardPoint({ ...card, topic: "Threshold", guideline_says: "A threshold is 4.6 units. Another sentence." })).toBe("Threshold: A threshold is 4.6 units.");
  });
});

describe("discussion diversity", () => {
  const eligible = filterEligible(cards, input.conditions, input.medicines);
  const reply = (ids: string[]) => JSON.stringify({ points: ids.map((card_id) => ({ card_id, point: "Discuss this topic." })) });
  it("keeps only one SGLT2 card and backfills with the next model rank", () => {
    const points = validateModelOutput(reply(["E4", "E2", "E3", "E9", "E6", "E5"]), eligible, input);
    expect(points?.map((p) => p.card_id)).toEqual(["E4", "E2", "E6"]);
    expect(points?.[1]?.supporting_card_ids).toEqual(["E3", "E9"]);
  });
  it("uses pack-order backfill when no remaining model rank is available", () => {
    const points = validateModelOutput(reply(["E2", "E3", "E9"]), eligible, input);
    expect(points?.map((p) => p.card_id)).toEqual(["E2", "E1", "E4"]);
    expect(points?.[1]?.standardized).toBe(true);
    expect(points?.[1]?.point).toBe(standardPoint(eligible[0] as Card));
  });
  it("applies diversity to fallback as well", () => {
    expect(fallbackPoints(eligible, "Preserved EF").map((p) => p.card_id)).toEqual(["E1", "E2", "E4"]);
  });
  it("does not attach ineligible supporting cards", () => {
    const points = validateModelOutput(reply(["E9", "E3"]), filterEligible(cards, ["heart_failure"], []));
    expect(points?.map((p) => p.card_id)).toEqual(["E9"]);
    expect(points?.[0]?.supporting_card_ids).toEqual(["E3"]);
  });
});
