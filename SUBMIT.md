# Nebius x NVIDIA submission kit

Deadline: Fri Oct 30 2026, 10:00 AM PT / 1:00 PM ET. Track: Best Apps and Agents.

## Your steps (about 60 to 90 minutes total)

1. Keys (10 min)
   - Token Factory key: tokenfactory.nebius.com, API keys, Create API key
   - Tavily key: from the Builder Program credit or tavily.com
2. PAUSE gate: approve repo push and Netlify deploy (Claude can do both once you say go)
   - GitHub repo: `saebchicago/conditionmap-navigator` (public, required for judging)
   - Netlify site under Excellence Team; set `NEBIUS_API_KEY` and `TAVILY_API_KEY` as env vars in the Netlify UI (you paste keys, Claude never sees them)
3. Model check (2 min): open `https://<site>/api/navigator`. Confirm `modelDraftFound: true`. If false, copy an ID from `nemotronModelsAvailable` into `NEBIUS_MODEL_DRAFT` and `NEBIUS_MODEL_FAST`, redeploy
4. Run 3 test briefs (15 min). Read every point against its source link. If any point is wrong, stop and tell Claude
5. Record demo (20 min) using the script below
6. Devpost form (15 min): paste copy below, repo link, live link, video link

## Devpost copy

**Name:** Navigator by ConditionMap

**Tagline:** Three cited questions for the next appointment when heart failure, diabetes, and kidney disease collide.

**Inspiration**
Heart failure, type 2 diabetes, and chronic kidney disease travel together, and they share medicines, labs, and warning signs. Caregivers often get advice for each condition from a different clinician and are left to notice the conflicts themselves. Navigator helps them walk in with the right questions.

**What it does**
A caregiver picks the conditions, the appointment type, and optionally writes what has been on their mind. Navigator returns up to three discussion points about where the conditions interact. Each point has a plain-language reason, one question to read aloud, and links to the guideline or patient-education source it came from. The brief prints on one page with space for notes.

**How we built it**
A four-step agent: Plan, Retrieve, Draft, Verify. NVIDIA Nemotron on Nebius Token Factory plans targeted searches and drafts the points. Tavily retrieves only from an allowlist of guideline and patient-education publishers. A second Nemotron pass checks every claim against its cited text, and a code-level gate drops any point with no valid citation or with dose or medicine start/stop language. The browser runs each step as its own request, so users watch the agent work and see what the checker removed.

**Challenges**
Keeping a capable model inside narrow lines. We chose to show fewer points over unsupported ones, and to make every removal visible.

**Accomplishments**
No evidence, no output. Every point shown links to its source.

**What we learned**
Verification has to be layered: model checker, deterministic filters, and an interface that shows the work.

**What's next**
Clinician review of the prompts and allowlist, more condition clusters, and Spanish and Arabic briefs for Southeast Michigan families.

**Built with:** NVIDIA Nemotron, Nebius Token Factory, Tavily, TypeScript, React, Vite, Netlify Functions

## Demo script (2:30, voiceover)

0:00 Problem. "My [relative] has heart failure, diabetes, and kidney disease. Three specialists, three sets of advice. The conflicts land on the caregiver."
0:20 Intake. Select all three conditions, nephrology visit, type a concern such as new ankle swelling and a confusing kidney lab.
0:40 Trace. Narrate each step as it lights up: Nemotron plans searches, Tavily pulls only from vetted publishers, Nemotron drafts, a second Nemotron pass verifies.
1:30 Brief. Read one point and its question. Click its source link to show it is real.
1:50 Removed points. Open "removed by the checker" and say why that matters.
2:05 Print. Show the one-page brief.
2:15 Close. "Built on Nemotron and Nebius Token Factory. Evidence first, nothing stored, and it always sends you back to your care team."

Do not use a real patient's details in the recording.
