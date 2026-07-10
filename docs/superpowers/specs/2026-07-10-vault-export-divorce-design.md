# Vault Export Divorce from Obsidian CRM — Design

**Date:** 2026-07-10
**Status:** Approved by JD (chat), pending spec review
**Branch:** v2.0

## Problem

The vault export pipeline was built for an Obsidian-CRM workflow the user does not
use. He views the exported files as plain markdown on a shared drive
(`I:\Shared drives\Clients\...`). The CRM extras create noise:

- Every export auto-creates `People/{Name}.md` and `Companies/{Org}.md` pages.
- Meeting files wrap names in Obsidian `[[wikilinks]]` that point at those pages
  and read poorly outside Obsidian.
- The button says "Export to Obsidian" when the target is really "the vault"
  (a folder structure on a shared drive).
- Cosmetic: the meeting folder and file are slugged by two different slugifiers,
  producing mismatches like folder `...and-jd-bruce/` vs file
  `...and-j-d-bruce.md` for the title "Stephanie Bucko and J.D. Bruce".

## Goals

1. Keep meeting-file routing exactly as is (clients table → vault folders,
   `_unfiled` fallback, speaker-mapping email fallback).
2. Eliminate ALL contact/company page creation — automatic and manual.
3. Keep the Google Contacts integration (speaker matching, enrichment,
   voice-profile linking) untouched.
4. Meeting files read cleanly as plain markdown (no wikilinks).
5. Rename user-facing "Export to Obsidian" → "Export to Vault".
6. One shared slugifier so folder and file names always agree.

## Non-Goals

- No renaming of internal identifiers (`obsidianLink` DB column,
  `exportMeetingToObsidian`, `[ObsidianExport]` log prefixes). Renaming buys
  nothing and risks the sync-state checks; user-facing strings only.
- No cleanup tooling for existing `People/` and `Companies/` files or
  already-exported meetings. Existing files stay on disk; the user deletes them
  manually if desired. Stored `obsidianLink` paths keep working.
- No settings toggle to re-enable page creation (YAGNI; git history preserves
  the code).

## Design

### 1. Remove page creation (approach: outright removal)

Delete, in `src/main.js`:
- The `autoCreateContactAndCompanyPages(meeting, routes)` call inside
  `exportMeetingToObsidian` (~line 3927) and the function itself (~4213-4414).
- IPC handlers `contacts:createContactPage` (~5640) and
  `contacts:createCompanyPage` (~5678).

Delete elsewhere:
- `src/preload.js`: the two `contacts:create*Page` bridge methods (~179, ~183).
- `src/main/validation/ipcSchemas.js`: schemas for the two removed handlers
  (including the `createCompanyPage` option flag, ~284).
- `src/renderer/contacts.js` + `src/renderer/companyDetail.js`: "Create page"
  buttons and their click handlers (e.g. `createCompanyPageBtn`, the
  `contact-create-page-btn` class usages). The Contacts/Companies *view* stays —
  it reads Google Contacts and the clients DB, not vault files.
- `src/main/storage/VaultStructure.js`: `createContactPage` (~461) and
  `createCompanyPage` (~523) methods.
- `src/main/templates/contactTemplate.js` and `companyTemplate.js` (entire
  modules) and any unit tests covering them.

Alternatives considered: feature flag (keeps ~600 unused lines + a setting that
contradicts the user's direction) and no-op stubs (code lies about what it
does). Rejected for a personal app; removal is reversible via git.

### 2. Meeting files use plain names

In the meeting summary/transcript markdown generation in `src/main.js`:
- Frontmatter participants: `"[[Name]]"` → `"Name"` (~4003, 4020). Keep the
  YAML quotes.
- Frontmatter company: `"[[Company]]"` → `"Company"` (~4062).
- Participant list in the summary body: `[[Name]]` → `Name` (~4153).
- Transcript speaker labels: `[[Name]]:` → `Name:` (~4179).
- Summary↔transcript cross-links become standard markdown relative links,
  clickable in Drive preview / VS Code / Obsidian alike:
  - Summary (~4112): `**Full Transcript:** [Transcript](./{baseFilename}-transcript.md)`
  - Transcript (~4136): `**Back to summary:** [Summary](./{baseFilename}.md)`

### 3. User-facing rename

"Export to Obsidian" → "Export to Vault" in `src/index.html` (~390, ~708) and
any renderer toast/tooltip strings that say "Obsidian" in the export flow
(check `renderer.js` ~2600 and `renderer\meetingDetail.js` ~314 areas). Log
lines and internal names are exempt (see Non-Goals).

### 4. Unified slug generation

New shared helper (location: `src/main/utils/slugify.js`, plain function,
no deps):

```js
function slugify(title) {
  return String(title || 'meeting')
    .toLowerCase()
    .replace(/['’.]/g, '')        // J.D. → jd, O'Brien → obrien
    .replace(/[^a-z0-9]+/g, '-')  // collapse everything else to dashes
    .replace(/^-+|-+$/g, '');     // trim edge dashes
}
```

Used by all three current slug sites:
- `RoutingEngine._slugify` (`src/main/routing/RoutingEngine.js:143`) — replace
  its body with a call to the shared helper (or delete the method and call the
  helper at line 48).
- File slug in `exportMeetingToObsidian` (`src/main.js` ~3836).
- The `routingOverride` branch's folder slug (`src/main.js` ~3778).

Note the current divergence this fixes: `_slugify` strips punctuation before
collapsing (`J.D.` → `jd`) while the main.js sites collapse punctuation into
dashes (`J.D.` → `j-d`). The shared helper canonicalizes on the `jd` behavior.
Empty/falsy titles slug to `meeting` (RoutingEngine's `'untitled-meeting'`
default at line 48 changes to `meeting` for consistency). Already-exported meetings are unaffected: their `obsidianLink` is
stored and reused; only new exports derive names.

### 5. What stays untouched

- DB-driven routing: clients table, `client_contacts`, speaker-mapping email
  fallback (commit 4f620c6), `_unfiled/{YYYY-MM}` fallback.
- Google Contacts: OAuth, contact matching/enrichment, LRU cache,
  voice-profile ↔ contact linking.
- Two-file architecture (summary + transcript), YAML frontmatter shape (values
  lose brackets, keys unchanged).
- Auto-export trigger after template generation; Export button behavior
  (label changes only).

### 6. Testing

- New unit tests: `slugify` (punctuated names, apostrophes, empty title,
  numbered variants); markdown generation asserts plain names, no `[[`
  anywhere, and correct relative links (if generation is testable as a unit;
  otherwise assert via the smallest extractable helper).
- Update/delete: contactTemplate/companyTemplate tests, VaultStructure tests
  covering the removed methods.
- Full suite green, zero lint warnings.
- Manual E2E: export a meeting → exactly two files appear in the routed folder,
  folder and file slugs match, button reads "Export to Vault", no People/ or
  Companies/ writes.
