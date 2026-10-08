# v2.1.4 Release Notes

## Highlights

Claude Haiku 4.5 is replaced by **Claude Haiku 5.5**, the new default for auto-summaries and pattern generation. It is roughly 10× cheaper than Haiku 4.5 and now the cheapest cloud model in the app.

---

## AI Models

- **Haiku 5.5 is the new default**: Auto-summary and pattern-generation defaults now use `claude-haiku-5-5` ($0.10 / $0.50 per million tokens for prompts up to 100K tokens; $0.50 / $2.50 above that). Haiku 4.5 was $1.00 / $5.00.
- **Existing settings upgrade automatically**: A saved `claude-haiku-4-5` choice (in settings or on older meetings) now runs on Haiku 5.5. Older meetings still show "Claude Haiku 4.5" as the model they were created with.
- **Moved to the Budget tier**: Model dropdowns and the regenerate dialog now list Haiku 5.5 under Budget, ahead of Gemini 3.5 Flash Lite. The cost estimator uses the new prices.
- **Updated request settings**: Haiku 5.5 rejects custom `temperature` values, so the app no longer sends one. It now runs with the model's default (adaptive) thinking, the same as Opus 5.5 and Sonnet 5.5, with extra output-token headroom so thinking doesn't cut summaries short.

## Things to Expect

- **Higher token counts in logs**: Haiku 5.5 uses a newer tokenizer that counts the same text as about 30% more tokens. Costs still drop sharply because the per-token price is much lower.

---

## Files Changed

13 files changed, ~100 additions, ~60 deletions (net +40 lines) across 1 commit since v2.1.3 (512 unit tests passing).
