# v1.3.2 Release Notes

## Highlights

This release removes OpenAI and Azure OpenAI as LLM providers, replacing them with Google Gemini and local Ollama. Claude models are updated to the latest generation. A recurring EPIPE crash in the main process is also fixed.

---

## LLM Provider Overhaul

- **OpenAI and Azure OpenAI removed**: The `OpenAIAdapter` and `AzureOpenAIAdapter` classes are deleted from `llmService.js`. All OpenAI model references (GPT-5 nano, GPT-4.1 nano, GPT-4o mini, GPT-5 mini, GPT-4.1 mini) and the entire Azure deployment management UI (endpoint config, deployment cards, modal) are gone.
- **Google Gemini added**: New `GeminiAdapter` class using `@google/generative-ai` SDK. Two models available:
  - `gemini-2.5-flash-lite` — Budget tier ($0.075/$0.30 per MTok)
  - `gemini-2.5-flash` — Balanced tier ($0.15/$0.60 per MTok)
- **Ollama (local) added**: New `OllamaAdapter` using Ollama's OpenAI-compatible API at `http://localhost:11434/v1`. Models are fetched dynamically from the local Ollama instance — no hardcoded model list. Zero cost, runs entirely on-device.
- **Dynamic Ollama model dropdowns**: All four model selectors (generate, auto-summary, template summary, pattern generation) populate an Ollama optgroup at runtime showing model name and size (e.g., "qwen3:14b (9.0GB) — Free").
- **New IPC handler**: `ollama:listModels` exposed via preload for renderer-side model listing.

## Claude Model Updates

- **Claude Sonnet 4.6**: Replaces Sonnet 4 as the premium tier ($3.00/$15.00 per MTok).
- **Claude Haiku 4.5**: Retained as the balanced tier ($0.80/$4.00 per MTok).
- **Removed**: Claude Sonnet 4.5 (redundant at same price point as Sonnet 4.6) and Claude Opus 4.

## Provider Priority & Defaults

- **Priority order changed**: `Azure > OpenAI > Anthropic` → `Anthropic > Gemini > Ollama`.
- **Default model changes**:
  - Auto-summary: `openai-gpt-4o-mini` → `gemini-2.5-flash`
  - Template summary: `openai-gpt-4o-mini` → `claude-haiku-4-5`
  - Pattern generation: `openai-gpt-5-nano` → `gemini-2.5-flash-lite`

## EPIPE Crash Fix

- **Broken pipe protection**: Added `EPIPE` error handlers on `process.stdout` and `process.stderr` at the top of `main.js`. Previously, when the parent terminal closed (or Electron Forge's pipe management hiccupped), any `console.log` call would throw an uncaught exception and crash the app.
- **GoogleCalendar logging migrated to electron-log**: All `console.log`/`console.error` calls in `GoogleCalendar.js` replaced with `log.info`/`log.debug`/`log.error`/`log.warn`. This eliminates the EPIPE trigger — `electron-log` writes to files, not stdout. Verbose per-event debug logging in `getUpcomingMeetings()` condensed to a single summary line.

## Settings UI Cleanup

- **Azure section removed**: ~290 lines of Azure deployment management UI deleted from `settings.js` and `index.html` — the deployment modal, endpoint input, deployment cards, and `updateModelDropdownsWithAzure()`.
- **Key management updated**: `OPENAI_API_KEY` and `AZURE_OPENAI_API_KEY` references replaced with `GOOGLE_API_KEY` and `OLLAMA_BASE_URL` throughout `keyManagementService.js`.

---

## Dependency Updates

### New Dependencies
| Package | Version | Purpose |
|---------|---------|---------|
| `@google/generative-ai` | ^0.24.1 | Google Gemini SDK |

### Removed
- `openai` SDK — no longer needed (removed from imports, not from package.json as it was never a direct dependency)

---

## Files Changed

14 files changed, ~607 additions, ~1,085 deletions (net -478 lines)
