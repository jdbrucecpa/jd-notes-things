# v2.1.2 Release Notes

## Highlights

**Claude Sonnet 5.5** replaces Sonnet 5 as the default template-summary model, and both Sonnet 5.5 and Opus 5.5 now think before writing summaries, which made quotes more faithful and facts more accurate in side-by-side testing. The update banner also keeps its "Restart Now" prompt once an update has downloaded.

---

## AI Models

- **Claude Sonnet 5.5 replaces Sonnet 5**: Sonnet 5.5 (same $2.00/$10.00 per MTok price) is now the option in every model dropdown, the Regenerate menu, and the default for template summaries. Settings or meetings that reference Sonnet 5 switch to Sonnet 5.5 automatically.
- **Summaries now use each model's default thinking**: Sonnet 5.5 runs with adaptive thinking at its default `high` effort, and Opus 5.5 at its default `medium` effort (previously `low`). Both get extra output-token headroom so thinking can't cut a summary short. Sonnet 5.5 rejects the "thinking disabled" setting Sonnet 5 summaries used, so the previous request would have failed outright.
- **Why defaults**: In a side-by-side on a real meeting with the Full Notes and Quotes & Insights templates, lower thinking condensed or tidied "verbatim" quotes and got a fact wrong that required connecting two lines of the transcript. Sonnet 5.5 at its default matched Opus 5.5's level of detail at under half the cost (about $0.17 vs. $0.38 for both templates, before prompt caching). Expect Opus 5.5 summaries to be more thorough and somewhat more expensive than in 2.1.1.

## Updates

- **"Restart Now" prompt no longer disappears**: After an update finished downloading, the next hourly check reported "no update available" (the package was already local) and replaced the restart prompt with "You're up to date". Check Now said "You are running the latest version" too. Downloaded updates then waited silently until the next manual restart. The app now remembers a downloaded update: hourly checks leave the restart banner alone, and Check Now reports "Update vX is downloaded — restart the app to install it". This takes effect for updates after 2.1.2.

---

## Files Changed

12 files changed, ~134 additions, ~53 deletions (net +81 lines) across 3 commits since v2.1.1.
