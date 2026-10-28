import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import pack from "@/data/evidence-pack.json";
import {
  filterEligible,
  fallbackPoints,
  type BriefPoint,
  type Card,
  type ConditionKey,
  type Source,
} from "@/lib/navigator";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Navigator by ConditionMap: caregiver appointment brief" },
      { name: "description", content: "Prepare up to 3 guideline-based questions for a visit about heart failure, type 2 diabetes, or kidney disease. Educational only." },
      { property: "og:title", content: "Navigator by ConditionMap" },
      { property: "og:description", content: "A caregiver appointment brief built from published guidelines, ranked by NVIDIA Nemotron." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const CARDS = pack.cards as Card[];
const SOURCES = pack.sources as Record<string, Source>;
const CONDITIONS: { key: ConditionKey; label: string }[] = [
  { key: "heart_failure", label: "Heart failure" },
  { key: "type_2_diabetes", label: "Type 2 diabetes" },
  { key: "ckd", label: "Chronic kidney disease" },
];
const HF_TYPES = ["Reduced EF", "Mildly reduced EF", "Preserved EF", "Not sure"];
const CHIPS = ["metformin", "empagliflozin", "dapagliflozin", "lisinopril", "losartan", "finerenone", "semaglutide", "pioglitazone", "furosemide"];
const NUMBERS = [
  { key: "egfr", label: "eGFR", hint: "mL/min/1.73m²" },
  { key: "uacr", label: "Urine albumin (UACR)", hint: "mg/g" },
  { key: "a1c", label: "A1C", hint: "%" },
  { key: "bp", label: "Blood pressure", hint: "e.g. 130/80" },
  { key: "potassium", label: "Potassium", hint: "mmol/L" },
];
const STEPS = ["Conditions", "Medicines", "Latest numbers", "Your brief"];

interface Result {
  points: BriefPoint[];
  mode: "nemotron" | "fallback";
  model?: string;
  latency_ms?: number;
  error?: string;
}

function Index() {
  const [step, setStep] = useState(0);
  const [conditions, setConditions] = useState<ConditionKey[]>([]);
  const [hfType, setHfType] = useState("");
  const [meds, setMeds] = useState("");
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [unknown, setUnknown] = useState<Record<string, boolean>>({});
  const [worry, setWorry] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const medList = meds.split("\n").map((m) => m.trim()).filter(Boolean);

  const toggleCond = (k: ConditionKey) =>
    setConditions((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  const addChip = (m: string) => {
    if (medList.some((x) => x.toLowerCase() === m)) return;
    setMeds((v) => (v.trim() ? `${v.trim()}\n${m}` : m));
  };

  const example = () => {
    setConditions(["heart_failure", "type_2_diabetes", "ckd"]);
    setHfType("Preserved EF");
    setMeds("metformin\nlisinopril\nfurosemide");
    setNumbers({ egfr: "38", uacr: "120", a1c: "7.9", bp: "142/86", potassium: "4.6" });
    setUnknown({});
    setWorry("Her ankles are swelling more and I'm not sure her diabetes pills are still safe for her kidneys.");
    setResult(null);
    setStep(2);
  };

  const generate = async () => {
    setStep(3);
    setLoading(true);
    setResult(null);
    const nums: Record<string, string> = {};
    for (const n of NUMBERS) nums[n.key] = unknown[n.key] ? "don't know" : numbers[n.key]?.trim() || "not provided";
    const eligible = filterEligible(CARDS, conditions, medList);
    try {
      const r = await fetch("/api/public/navigator-brief", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conditions, hfType: conditions.includes("heart_failure") ? hfType : undefined, medicines: medList, numbers: nums, worry }),
      });
      const data = (await r.json()) as Result;
      if (!r.ok || !Array.isArray(data.points)) throw new Error("bad_response");
      setResult(data);
    } catch {
      setResult({ points: fallbackPoints(eligible, conditions.includes("heart_failure") ? hfType : undefined), mode: "fallback", error: "service_unreachable" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div role="alert" className="no-print border-b-2 border-destructive bg-card px-4 py-3">
        <p className="mx-auto max-w-3xl rounded-md border-2 border-destructive px-3 py-2 text-center font-semibold text-destructive">
          If someone has chest pain, severe shortness of breath, fainting, or confusion, call 911 now.
        </p>
      </div>

      <header className="mx-auto flex max-w-3xl items-baseline justify-between gap-4 px-4 pt-6 pb-2">
        <h1 className="text-3xl font-bold tracking-tight text-primary">
          Navigator <span className="text-base font-medium text-muted-foreground">by ConditionMap</span>
        </h1>
        <button type="button" onClick={example} className="no-print focus-ring rounded-md border-2 border-accent px-3 py-1.5 text-sm font-semibold text-foreground hover:bg-accent/15">
          Try an example
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-12">
        <p className="no-print mb-6 text-muted-foreground">
          Get ready for a visit about heart failure, type 2 diabetes, or kidney disease. You will get up to 3 questions to ask, each tied to a published guideline.
        </p>

        <ol aria-label="Progress" className="no-print mb-6 grid grid-cols-4 gap-2">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined} className="flex flex-col gap-1">
              <span className={`h-2 rounded-full ${i <= step ? "bg-primary" : "bg-border"}`} />
              <span className={`text-xs sm:text-sm ${i === step ? "font-semibold text-primary" : "text-muted-foreground"}`}>
                {i + 1}. {s}
              </span>
            </li>
          ))}
        </ol>

        {step === 0 && (
          <section className="card-surface p-5 sm:p-6">
            <fieldset>
              <legend className="mb-3 text-xl font-semibold">Which conditions does the person have?</legend>
              <div className="flex flex-col gap-2">
                {CONDITIONS.map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 hover:bg-secondary">
                    <input type="checkbox" className="focus-ring size-5 accent-primary" checked={conditions.includes(c.key)} onChange={() => toggleCond(c.key)} />
                    {c.label}
                  </label>
                ))}
              </div>
            </fieldset>
            {conditions.includes("heart_failure") && (
              <fieldset className="mt-5">
                <legend className="mb-2 font-semibold">Heart failure type (optional)</legend>
                <div className="flex flex-wrap gap-2">
                  {HF_TYPES.map((t) => (
                    <label key={t} className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 hover:bg-secondary">
                      <input type="radio" name="hf" className="focus-ring size-4 accent-primary" checked={hfType === t} onChange={() => setHfType(t)} />
                      {t}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <Nav next={() => setStep(1)} nextDisabled={!conditions.length} />
          </section>
        )}

        {step === 1 && (
          <section className="card-surface p-5 sm:p-6">
            <label htmlFor="meds" className="mb-1 block text-xl font-semibold">Current medicines</label>
            <p id="meds-hint" className="mb-3 text-sm text-muted-foreground">One per line. Tap a name below to add it.</p>
            <textarea id="meds" aria-describedby="meds-hint" rows={5} value={meds} onChange={(e) => setMeds(e.target.value)} className="focus-ring w-full rounded-md border-2 border-input bg-card p-3" />
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Quick add medicines">
              {CHIPS.map((m) => {
                const on = medList.some((x) => x.toLowerCase() === m);
                return (
                  <button key={m} type="button" aria-pressed={on} onClick={() => addChip(m)} className={`focus-ring rounded-full border px-3 py-1 text-sm ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-secondary text-secondary-foreground hover:border-primary"}`}>
                    + {m}
                  </button>
                );
              })}
            </div>
            <Nav back={() => setStep(0)} next={() => setStep(2)} />
          </section>
        )}

        {step === 2 && (
          <section className="card-surface p-5 sm:p-6">
            <h2 className="mb-1 text-xl font-semibold">Latest numbers</h2>
            <p className="mb-4 text-sm text-muted-foreground">All optional. Check "Don't know" if you are unsure.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {NUMBERS.map((n) => (
                <div key={n.key}>
                  <label htmlFor={n.key} className="block font-medium">{n.label} <span className="text-sm text-muted-foreground">({n.hint})</span></label>
                  <input id={n.key} inputMode="decimal" disabled={unknown[n.key]} value={numbers[n.key] ?? ""} onChange={(e) => setNumbers({ ...numbers, [n.key]: e.target.value.slice(0, 12) })} className="focus-ring mt-1 w-full rounded-md border-2 border-input bg-card p-2 disabled:opacity-50" />
                  <label className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="checkbox" className="focus-ring accent-primary" checked={!!unknown[n.key]} onChange={(e) => setUnknown({ ...unknown, [n.key]: e.target.checked })} />
                    Don't know
                  </label>
                </div>
              ))}
            </div>
            <label htmlFor="worry" className="mt-6 block font-semibold">What worries you most before this visit?</label>
            <textarea id="worry" rows={3} maxLength={300} value={worry} onChange={(e) => setWorry(e.target.value)} className="focus-ring mt-1 w-full rounded-md border-2 border-input bg-card p-3" />
            <p className="text-right text-sm text-muted-foreground" aria-live="polite">{worry.length}/300</p>
            <Nav back={() => setStep(1)} next={generate} nextLabel="Make my brief" />
          </section>
        )}

        {step === 3 && (
          <Brief
            loading={loading}
            result={result}
            conditions={conditions}
            onEdit={() => setStep(0)}
          />
        )}

        <p className="no-print mt-8 rounded-md bg-muted p-3 text-sm text-muted-foreground">
          <strong className="text-foreground">Privacy:</strong> No login and no storage. Your answers stay in this browser tab. When you make a brief, they are sent once to the AI model to rank the questions and are not saved by this app.
        </p>
      </main>

      <footer className="no-print border-t border-border bg-card px-4 py-6 text-sm text-muted-foreground">
        <div className="mx-auto flex max-w-3xl flex-col gap-1">
          <p>
            <a className="focus-ring font-medium text-primary underline" href="https://conditionmap.com" target="_blank" rel="noreferrer">conditionmap.com</a>
            {" · "}Built with NVIDIA Nemotron on Nebius Token Factory{" · "}MIT License
          </p>
          <p>By Saeb Ahsan. Sources: ADA/KDIGO 2022, ESC HF 2023, AHA/ACC/HFSA HF 2022. Evidence pack updated {pack.version}.</p>
          <p>No analytics, no cookies, no form data stored.</p>
        </div>
      </footer>
    </div>
  );
}

function Nav({ back, next, nextDisabled, nextLabel = "Next" }: { back?: () => void; next: () => void; nextDisabled?: boolean; nextLabel?: string }) {
  return (
    <div className="mt-6 flex justify-between gap-3">
      {back ? (
        <button type="button" onClick={back} className="focus-ring rounded-md border-2 border-border px-5 py-2.5 font-semibold hover:bg-muted">Back</button>
      ) : <span />}
      <button type="button" onClick={next} disabled={nextDisabled} className="focus-ring rounded-md bg-primary px-6 py-2.5 font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
        {nextLabel}
      </button>
    </div>
  );
}

function Brief({ loading, result, conditions, onEdit }: { loading: boolean; result: Result | null; conditions: ConditionKey[]; onEdit: () => void }) {
  if (loading || !result)
    return (
      <section className="card-surface p-6 text-center" aria-live="polite">
        <p className="font-semibold text-primary">Building your brief from the evidence pack...</p>
      </section>
    );

  const byId = new Map(CARDS.map((c) => [c.id, c]));
  const condLabel = CONDITIONS.filter((c) => conditions.includes(c.key)).map((c) => c.label).join(", ");

  return (
    <section aria-live="polite">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-primary">Your appointment brief</h2>
          <p className="text-sm text-muted-foreground">For: {condLabel}</p>
        </div>
        <div className="no-print flex gap-2">
          <button type="button" onClick={onEdit} className="focus-ring rounded-md border-2 border-border px-4 py-2 font-semibold hover:bg-muted">Edit answers</button>
          <button type="button" onClick={() => window.print()} className="focus-ring rounded-md bg-accent px-4 py-2 font-semibold text-accent-foreground hover:bg-accent/90">Bring this to the visit</button>
        </div>
      </div>

      {result.mode === "fallback" && (
        <p className="mb-4 rounded-md border-2 border-accent bg-accent/10 p-3 text-sm">
          <strong>Fallback: rule-based selection.</strong>{" "}
          {result.error ? "The AI ranking was not available, so these points are the first eligible cards from the evidence pack." : ""}
        </p>
      )}

      {result.points.length === 0 ? (
        <p className="card-surface p-5">No evidence cards match these conditions and medicines yet.</p>
      ) : (
        <ol className="flex flex-col gap-4">
          {result.points.map((p, i) => {
            const card = byId.get(p.card_id);
            if (!card) return null;
            const src = SOURCES[card.source];
            if (!src) return null;
            const supportingSources = [...new Set((p.supporting_card_ids ?? []).flatMap((id) => {
              const supporting = byId.get(id);
              return supporting && supporting.source !== card.source ? [supporting.source] : [];
            }))];
            const year = card.source.match(/\d{4}/)?.[0];
            return (
              <li key={p.card_id} className="card-surface print-card p-5">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-bold text-primary">{i + 1}. {card.topic}</span>
                  <span className="rounded-full border border-success px-2 py-0.5 text-xs font-semibold text-success">{card.label}</span>
                  {p.standardized && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">standardized wording</span>}
                </div>
                {p.point !== card.topic && <p className="mb-3">{p.point}</p>}
                <div className="rounded-md border-l-4 border-accent bg-secondary p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-secondary-foreground">Ask your clinician</p>
                  <p className="font-semibold">"{card.question_for_clinician}"</p>
                </div>
                <details className="mt-3">
                  <summary className="focus-ring cursor-pointer font-medium text-primary">What the guideline says</summary>
                  <p className="mt-2 text-muted-foreground">{card.guideline_says}</p>
                </details>
                <a href={`https://doi.org/${src.doi}`} target="_blank" rel="noreferrer" className="focus-ring mt-3 inline-block rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground underline-offset-2 hover:underline">
                  {card.source.replace(/_\d{4}$/, "").replace("_", "/")} {year} · doi:{src.doi}
                </a>
                {supportingSources.length > 0 && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Also supported by</span>
                  {supportingSources.map((sourceId) => {
                    const source = SOURCES[sourceId];
                    if (!source) return null;
                    return <a key={sourceId} href={`https://doi.org/${source.doi}`} target="_blank" rel="noreferrer" className="focus-ring rounded-full bg-muted px-3 py-1 font-medium text-foreground hover:underline">{sourceId.replace(/_\d{4}$/, "").replace("_", "/")} {sourceId.match(/\d{4}/)?.[0]} · doi:{source.doi}</a>;
                  })}
                </div>}
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-5 rounded-md border border-border bg-card p-3 text-sm font-medium">
        Educational information from published guidelines. Not medical advice. Decisions belong to you and your care team.
      </p>

      {result.points.length > 0 && (
        <details className="no-print card-surface mt-5 p-4">
          <summary className="focus-ring cursor-pointer font-semibold text-primary">Why these 3?</summary>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {result.points.map((p) => (
              <li key={p.card_id}><strong>{byId.get(p.card_id)?.topic}:</strong> {p.rationale || "Eligible by rule."}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-5 text-xs text-muted-foreground">
        <p className="font-semibold">How this brief was made</p>
        <p>Cards filtered by rules, ranked and phrased by NVIDIA Nemotron on Nebius Token Factory, checked against the evidence pack.</p>
        <p>
          Model: {result.mode === "nemotron" ? result.model : "none (rule-based)"}
          {result.latency_ms != null && ` · ${result.latency_ms} ms`}
        </p>
      </div>
    </section>
  );
}
