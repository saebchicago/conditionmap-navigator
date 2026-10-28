import { useState } from "react";
import { APPOINTMENTS, CONDITIONS, api, type ConditionId, type Intake, type Point, type Source } from "./api";

type StepKey = "plan" | "retrieve" | "draft" | "verify";
type StepState = { status: "idle" | "running" | "done" | "error"; detail?: string; ms?: number };

const STEP_COPY: Record<StepKey, { name: string; does: string }> = {
  plan: { name: "Plan", does: "Nemotron maps where these conditions interact and writes targeted searches." },
  retrieve: { name: "Retrieve", does: "Tavily searches only vetted guideline and patient-education publishers." },
  draft: { name: "Draft", does: "Nemotron writes up to three discussion points, each tied to a cited source." },
  verify: { name: "Verify", does: "A second Nemotron pass checks every claim against its source. Unsupported points are dropped." },
};

const ORDER: StepKey[] = ["plan", "retrieve", "draft", "verify"];
const idleSteps = (): Record<StepKey, StepState> => ({
  plan: { status: "idle" },
  retrieve: { status: "idle" },
  draft: { status: "idle" },
  verify: { status: "idle" },
});

export default function App() {
  const [conditions, setConditions] = useState<ConditionId[]>(["hf", "t2d", "ckd"]);
  const [appointmentType, setAppointmentType] = useState<Intake["appointmentType"]>("primary care");
  const [concerns, setConcerns] = useState("");
  const [steps, setSteps] = useState(idleSteps);
  const [queries, setQueries] = useState<string[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [kept, setKept] = useState<Point[]>([]);
  const [rejected, setRejected] = useState<Point[]>([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  const toggle = (id: ConditionId) =>
    setConditions((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const mark = (k: StepKey, s: StepState) => setSteps((prev) => ({ ...prev, [k]: s }));

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (running || conditions.length === 0) return;
    const intake: Intake = { conditions, appointmentType, concerns };
    setRunning(true);
    setFinished(false);
    setError("");
    setSteps(idleSteps());
    setQueries([]);
    setSources([]);
    setKept([]);
    setRejected([]);

    let current: StepKey = "plan";
    try {
      mark("plan", { status: "running" });
      const p = await api.plan(intake);
      setQueries(p.queries);
      mark("plan", { status: "done", ms: p.ms, detail: `${p.queries.length} searches planned` });

      current = "retrieve";
      mark("retrieve", { status: "running" });
      const r = await api.retrieve(intake, p.queries);
      setSources(r.sources);
      mark("retrieve", { status: "done", ms: r.ms, detail: `${r.sources.length} sources from vetted publishers` });
      if (r.sources.length === 0) {
        throw new Error("No vetted sources came back, so Navigator will not draft anything. Try rewording your notes.");
      }

      current = "draft";
      mark("draft", { status: "running" });
      const d = await api.draft(intake, r.sources);
      mark("draft", { status: "done", ms: d.ms, detail: `${d.points.length} cited points drafted` });

      current = "verify";
      mark("verify", { status: "running" });
      const v = await api.verify(intake, r.sources, d.points);
      setKept(v.kept);
      setRejected(v.rejected);
      mark("verify", {
        status: "done",
        ms: v.ms,
        detail: `${v.kept.length} kept, ${v.rejected.length} removed`,
      });
      setFinished(true);
    } catch (err) {
      mark(current, { status: "error", detail: (err as Error).message });
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const byId = new Map(sources.map((s) => [s.id, s]));
  const today = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const condLabel = CONDITIONS.filter((c) => conditions.includes(c.id)).map((c) => c.label).join(" + ");

  return (
    <div className="page">
      <header className="masthead no-print">
        <div className="brand">
          <span className="mark" aria-hidden>◆</span>
          <span>Navigator</span>
          <span className="by">by ConditionMap</span>
        </div>
        <p className="tag">Heart failure, type 2 diabetes, and kidney disease share medicines, labs, and warning signs. Navigator finds where they collide and turns it into three questions you can bring to the next appointment.</p>
      </header>

      <main className="grid">
        <section className="panel intake no-print" aria-labelledby="intake-h">
          <h2 id="intake-h">Before the visit</h2>
          <form onSubmit={run}>
            <fieldset>
              <legend>Conditions</legend>
              <div className="chips">
                {CONDITIONS.map((c) => (
                  <label key={c.id} className={`chip ${conditions.includes(c.id) ? "on" : ""}`}>
                    <input type="checkbox" checked={conditions.includes(c.id)} onChange={() => toggle(c.id)} />
                    {c.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="field">
              <span>Appointment</span>
              <select value={appointmentType} onChange={(e) => setAppointmentType(e.target.value as Intake["appointmentType"])}>
                {APPOINTMENTS.map((a) => (
                  <option key={a} value={a}>
                    {a[0].toUpperCase() + a.slice(1)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>What has been on your mind? <em>optional</em></span>
              <textarea
                value={concerns}
                maxLength={600}
                rows={5}
                placeholder="Example: more ankle swelling this month, and a new kidney lab result we did not understand."
                onChange={(e) => setConcerns(e.target.value)}
              />
              <small>No names, birthdates, or record numbers. Nothing you type is stored.</small>
            </label>

            <button type="submit" disabled={running || conditions.length === 0}>
              {running ? "Working…" : "Build my appointment brief"}
            </button>
          </form>
        </section>

        <section className="panel trace no-print" aria-labelledby="trace-h" aria-live="polite">
          <h2 id="trace-h">How Navigator works</h2>
          <ol className="steps">
            {ORDER.map((k, i) => (
              <li key={k} className={`step ${steps[k].status}`}>
                <span className="dot">{steps[k].status === "done" ? "✓" : steps[k].status === "error" ? "!" : i + 1}</span>
                <div>
                  <div className="step-head">
                    <strong>{STEP_COPY[k].name}</strong>
                    {steps[k].ms !== undefined && <span className="ms">{(steps[k].ms! / 1000).toFixed(1)}s</span>}
                  </div>
                  <p>{steps[k].detail ?? STEP_COPY[k].does}</p>
                  {k === "plan" && queries.length > 0 && (
                    <ul className="queries">
                      {queries.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {rejected.length > 0 && (
            <details className="rejected">
              <summary>{rejected.length} point{rejected.length > 1 ? "s" : ""} removed by the checker</summary>
              <ul>
                {rejected.map((p) => (
                  <li key={p.title}>
                    <strong>{p.title}</strong>
                    <span>{p.note}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </main>

      {error && !finished && <p className="error no-print" role="alert">{error}</p>}

      {finished && (
        <article className="brief" aria-labelledby="brief-h">
          <div className="brief-top">
            <div>
              <p className="eyebrow">Appointment brief · {today}</p>
              <h2 id="brief-h">{condLabel}</h2>
              <p className="sub">{appointmentType[0].toUpperCase() + appointmentType.slice(1)} visit</p>
            </div>
            <button className="ghost no-print" onClick={() => window.print()}>Print brief</button>
          </div>

          {kept.length === 0 ? (
            <p className="empty">The checker could not confirm any point against its sources, so Navigator is showing nothing rather than guessing. Try again with more detail in your notes.</p>
          ) : (
            <ol className="points">
              {kept.map((p, i) => (
                <li key={p.title} className="point">
                  <span className="num">{i + 1}</span>
                  <div>
                    <h3>{p.title}</h3>
                    <p className="why">{p.why}</p>
                    <p className="ask"><span>Ask</span>{p.ask}</p>
                    <p className="cites">
                      {p.sourceIds.map((id) => {
                        const s = byId.get(id);
                        return s ? (
                          <a key={id} href={s.url} target="_blank" rel="noreferrer">
                            {s.domain}: {s.title}
                          </a>
                        ) : null;
                      })}
                    </p>
                    <div className="notes print-only">Notes: ______________________________________________</div>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <footer className="fine">
            For education and conversation with your care team. Not medical advice. Do not start, stop, or change any medicine without your clinician. In an emergency call 911.
            <br />Generated by Navigator with NVIDIA Nemotron on Nebius Token Factory. Sources retrieved {today}.
          </footer>
        </article>
      )}

      <footer className="site no-print">
        Navigator is an educational prototype from ConditionMap. It does not store what you enter.
      </footer>
    </div>
  );
}
