export type ConditionId = "hf" | "t2d" | "ckd";

export const CONDITIONS: { id: ConditionId; label: string }[] = [
  { id: "hf", label: "Heart failure" },
  { id: "t2d", label: "Type 2 diabetes" },
  { id: "ckd", label: "Chronic kidney disease" },
];

export const APPOINTMENTS = [
  "primary care",
  "cardiology",
  "nephrology",
  "endocrinology",
  "hospital discharge follow-up",
  "other",
] as const;

export interface Intake {
  conditions: ConditionId[];
  appointmentType: (typeof APPOINTMENTS)[number];
  concerns: string;
}

export interface Source {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
}

export interface Point {
  title: string;
  why: string;
  ask: string;
  sourceIds: string[];
  verdict?: "supported" | "unsupported";
  note?: string;
}

async function step<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/navigator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ error: `Request failed (${res.status}).` }));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data as T;
}

export const api = {
  plan: (intake: Intake) => step<{ queries: string[]; ms: number; model: string }>({ step: "plan", intake }),
  retrieve: (intake: Intake, queries: string[]) =>
    step<{ sources: Source[]; ms: number }>({ step: "retrieve", intake, queries }),
  draft: (intake: Intake, sources: Source[]) =>
    step<{ points: Point[]; ms: number; model: string }>({ step: "draft", intake, sources }),
  verify: (intake: Intake, sources: Source[], points: Point[]) =>
    step<{ kept: Point[]; rejected: Point[]; ms: number; model: string }>({ step: "verify", intake, sources, points }),
};
