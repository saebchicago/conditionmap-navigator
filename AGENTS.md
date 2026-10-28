<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->
- Medical content comes only from src/data/evidence-pack.json (server copy in src/server/evidence-pack.ts, kept identical by test); the model only picks card IDs and phrasing, validated in src/lib/navigator.ts.
- Shared navigator finalization locks questions to evidence, lexically checks model points against card/input facts, and deduplicates medicine-class topics before model-rank then pack-order backfill; both server and browser fallback use it to keep output rules consistent.
- Nemotron calls go through the server route src/routes/api/public/navigator-brief.ts so NEBIUS_API_KEY stays server-side.
- Nemotron requests use JSON-object response format and disable thinking through chat_template_kwargs.enable_thinking so the reply budget is available for the validated brief rather than reasoning.
