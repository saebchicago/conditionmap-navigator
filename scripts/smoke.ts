// Offline smoke test of the pipeline logic with stubbed model and search.
// Stub text is labeled TEST FIXTURE and is never shipped to users.
import assert from "node:assert/strict";
import {
  draft,
  extractJson,
  plan,
  retrieve,
  scrubIdentifiers,
  validateIntake,
  verify,
  type ChatFn,
  type SearchFn,
} from "../netlify/functions/lib/pipeline.ts";

const FIX = "TEST FIXTURE";

const chat: ChatFn = async ({ messages }) => {
  const sys = messages[0].content;
  if (sys.includes("plan evidence searches")) {
    return `<think>reasoning</think>\n\`\`\`json\n{"queries":["${FIX} query one about kidneys","${FIX} query two about heart"]}\n\`\`\``;
  }
  if (sys.includes("prepare for a medical appointment")) {
    return JSON.stringify({
      points: [
        { title: `${FIX} point A`, why: `${FIX} why A.`, ask: `${FIX} ask A?`, sourceIds: ["S1"] },
        { title: `${FIX} point B`, why: `${FIX} why B, stop taking it.`, ask: `${FIX} ask B?`, sourceIds: ["S2"] },
        { title: `${FIX} point C`, why: `${FIX} why C.`, ask: `${FIX} ask C?`, sourceIds: ["S99"] },
        { title: `${FIX} point D`, why: `${FIX} why D.`, ask: `${FIX} ask D?`, sourceIds: ["S1", "S2"] },
      ],
    });
  }
  if (sys.includes("strict fact checker")) {
    return JSON.stringify({
      results: [
        { index: 0, verdict: "supported", note: "ok" },
        { index: 1, verdict: "supported", note: "ok" },
        { index: 2, verdict: "unsupported", note: "not in source" },
      ],
    });
  }
  throw new Error("unexpected prompt");
};

const longText = `${FIX} `.repeat(40);
const search: SearchFn = async (q) => [
  { title: `${FIX} heart`, url: "https://www.heart.org/a#x", content: longText },
  { title: `${FIX} kidney`, url: "https://www.kidney.org/b", content: longText },
  { title: `${FIX} untrusted`, url: "https://example.com/c", content: longText },
  { title: `${FIX} http`, url: "http://www.cdc.gov/d", content: longText },
  { title: `${FIX} short`, url: "https://medlineplus.gov/e", content: "short" },
  { title: `${FIX} dup ${q}`, url: "https://www.heart.org/a", content: longText },
];

// validation + scrubbing
const intake = validateIntake({
  conditions: ["hf", "ckd", "ckd", "bogus"],
  appointmentType: "nephrology",
  concerns: "Dad (MRN 12345) call 313-555-0100, email a@b.com, seen 10/12/2026. Swelling in ankles.",
});
assert.deepEqual(intake.conditions, ["hf", "ckd"]);
assert.ok(!/313-555|a@b\.com|12345|10\/12/.test(intake.concerns), "identifiers scrubbed");
assert.throws(() => validateIntake({ conditions: [] }));
assert.equal(scrubIdentifiers("plain"), "plain");

// json extraction with braces in strings
assert.deepEqual(extractJson<{ a: string }>('noise {"a":"x { y }"} tail'), { a: "x { y }" });

const queries = await plan(intake, chat);
assert.equal(queries.length, 2);

const sources = await retrieve(queries, search);
assert.deepEqual(sources.map((s) => s.domain), ["heart.org", "kidney.org"], "only trusted https, deduped, non-trivial");
assert.equal(sources[0].url, "https://www.heart.org/a");

const points = await draft(intake, sources, chat);
assert.equal(points.length, 3, "point C dropped for invalid citation, capped at 3");
assert.ok(points.every((p) => p.sourceIds.length > 0));

const { kept, rejected } = await verify(points, sources, chat);
assert.deepEqual(kept.map((p) => p.title), [`${FIX} point A`]);
assert.equal(rejected.length, 2);
assert.match(rejected[0].note, /safety filter/, "dose/stop language rejected even if checker approves");
assert.match(rejected[1].note, /not in source/);

// no evidence, no points
assert.deepEqual(await draft(intake, [], chat), []);

console.log("smoke: all assertions passed");
