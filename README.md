> **This repository is an earlier prototype (Netlify and Tavily) and is no longer maintained.** The current version, built for the Nebius x NVIDIA Global AI Hackathon, is at https://github.com/saebchicago/navigateconditionmap and the live app is at https://navigateconditionmap.lovable.app.

# Navigator by ConditionMap

Evidence-first appointment briefs for caregivers of people living with heart failure, type 2 diabetes, and chronic kidney disease.

These three conditions share medicines, labs, and warning signs. Advice for one can quietly conflict with another. Navigator finds where they collide and gives the caregiver up to three discussion points, each tied to a cited source and checked before it is shown.

## How it works

| Step | What happens | Runs on |
|---|---|---|
| Plan | Maps cross-condition interactions and writes up to 4 targeted searches | NVIDIA Nemotron via Nebius Token Factory |
| Retrieve | Searches an allowlist of guideline and patient-education publishers only | Tavily |
| Draft | Writes up to 3 points; any point without a valid citation is dropped in code | Nemotron via Token Factory |
| Verify | A second Nemotron pass checks each claim against its cited text; a deterministic filter removes dose or start/stop language | Nemotron via Token Factory, plus code |

No evidence, no output. If retrieval returns nothing, Navigator drafts nothing.

## Safety design

- Retrieval allowlist: heart.org, diabetes.org, kidney.org, kdigo.org, niddk.nih.gov, nhlbi.nih.gov, medlineplus.gov, cdc.gov, fda.gov, acc.org, hfsa.org
- Every point needs at least one valid source ID or it is discarded before verification
- Verifier rejects unsupported claims; a regex gate removes doses and medicine start/stop instructions even if the verifier approves
- Caregiver notes are scrubbed for emails, phone numbers, record numbers, and dates, then treated as untrusted data in every prompt
- Nothing is stored. No database, no logs of inputs
- Output framed as questions for the care team, with an education-only notice

## Stack

Vite + React + TypeScript frontend, one Netlify Function (`netlify/functions/navigator.mts`) that the browser calls once per step so the agent trace renders live and each request stays short. Pipeline logic lives in `netlify/functions/lib/pipeline.ts` with injected IO.

## Environment variables

| Name | Required | Default |
|---|---|---|
| `NEBIUS_API_KEY` | yes | |
| `TAVILY_API_KEY` | yes | |
| `NEBIUS_MODEL_DRAFT` | no | `nvidia/nemotron-3-super-120b-a12b` |
| `NEBIUS_MODEL_FAST` | no | `nvidia/nemotron-3-super-120b-a12b` |
| `NEBIUS_BASE_URL` | no | `https://api.tokenfactory.nebius.com/v1` |

`GET /api/navigator` reports which keys are set and which Nemotron model IDs your Token Factory key can see.

## Local

```bash
npm install
npx tsx scripts/smoke.ts   # offline pipeline test with labeled stubs
npx netlify dev            # full app with functions, needs keys in .env
```

## Not medical advice

Navigator is an educational prototype. It does not diagnose, does not recommend treatment, and is not a substitute for a clinician.
