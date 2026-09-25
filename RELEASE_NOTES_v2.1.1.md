# v2.1.1 Release Notes

## Highlights

Model currency update: **Claude Opus 5.5** replaces Opus 5 as the premium summary model at a lower price, and **Gemini 3.8 Flash** replaces 3.7 Flash in the balanced tier. Model pricing is refreshed throughout the app, and the release pipeline moves to the Node 24 GitHub Actions runtime.

---

## AI Models & Pricing

- **Claude Opus 5.5 replaces Opus 5**: The premium option for template summaries and regeneration is now Opus 5.5 at $4.00/$20.00 per MTok (was $5.00/$25.00). Opus 5.5 always thinks — it rejects the "thinking disabled" setting Opus 5 used — so summary requests now run it at low effort with 4,000 tokens of extra headroom, keeping cost and output length close to before.
- **Gemini 3.8 Flash replaces 3.7 Flash**: The balanced Gemini option moves to Google's newest Flash model at the same $0.75/$3.75 per MTok. This is introductory pricing through 2026-12-31; it rises to $1.50/$7.50 on 2027-01-01.
- **Gemini 3.5 Flash-Lite unchanged**: It remains Google's newest Flash-Lite model and stays the budget option ($0.30/$2.50).
- **Old selections carry forward**: Settings or meetings that reference Claude Opus 5, Gemini 3.7 Flash, or Gemini 3.5 Flash automatically use the new models, and their cost estimates use the new rates.
- **Pricing refreshed everywhere**: Settings dropdowns, the Generate and Regenerate model menus, and template cost estimates all show current prices.
- **Request-shape tests**: New unit tests cover the per-model API parameters, including a guard against `claude-opus-5-5` being mistaken for `claude-opus-5` by prefix matching.

## Build & Release Pipeline

- **Node 24 Actions runtime**: The release workflow moves to `actions/checkout` v7, `actions/setup-node` v7, and `softprops/action-gh-release` v3; the older versions were flagged as deprecated Node 20. The build itself now runs on Node 24, matching Electron 43's runtime (Node 20 reached end of life in April 2026).
- **Release skill fix**: The version bump now touches only `package.json` (and its lockfile); the About page reads the version at runtime.

---

## Files Changed

11 files changed, ~202 additions, ~80 deletions (net +122 lines) across 3 commits since v2.1.0.
