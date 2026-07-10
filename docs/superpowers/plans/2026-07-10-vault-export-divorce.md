# Vault Export Divorce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Divorce the vault export pipeline from the Obsidian-CRM workflow — stop creating People/Companies pages, emit plain-markdown meeting files with relative links, unify slug generation, and rename "Export to Obsidian" -> "Export to Vault".

**Architecture:** Surgical removal + rename against the existing Electron app. One new pure helper (`src/main/utils/slugify.js`) replaces three divergent slug sites. The meeting markdown generators in `src/main.js` drop `[[wikilinks]]` for plain names and standard relative links. All contact/company page creation (auto + manual) is deleted across main process, IPC, preload, schemas, renderer, VaultStructure, and the two template modules. DB-driven routing, Google Contacts, voice profiles, and the two-file architecture stay untouched.

**Tech Stack:** Electron main (src/main.js), vanilla JS renderer, Vitest, ESLint

---

## Findings from reading the code (read before executing)

These deviate from or extend the spec's literal removal list. They are resolved in the tasks below.

1. **Extra manual-create caller the spec missed:** `src/renderer/meetingDetail.js` has a whole `renderObsidianLinksSection(participant)` function (defined ~line 882, called at ~line 752) that renders "Create Contact Page" / "Create Company Page" buttons wired to `contactsCreateContactPage` / `contactsCreateCompanyPage`. The spec only named `contacts.js` + `companyDetail.js`. This section is manual page creation and MUST be removed (goal #2). Handled in Task 4.

2. **`companyDetail.js` has NO create-page buttons** — grep for `Obsidian|createContactPage|PageExists` returns nothing there. The spec's mention of it is a false lead; no edits needed in that file.

3. **`contactPageExists` / `companyPageExists` must also go.** The spec's removal list keeps them, but they `require('../templates/contactTemplate.js')` / `companyTemplate.js` for filename generation — modules the spec deletes. Keeping them would leave methods that `require()` a deleted file. Their only remaining callers are the four IPC handlers, whose only callers are the renderer sections being removed. So Task 4 removes the `contacts:contactPageExists` / `contacts:companyPageExists` IPC handlers + preload bridges, and Task 5 removes the two `*PageExists` VaultStructure methods alongside the two `create*Page` methods. Net: all four `contacts:*Page*` handlers and all four preload bridges go.

4. **Orphaned schemas:** `contactSchema` (ipcSchemas.js:276) is used ONLY by the two `create*Page` handlers -> orphaned after Task 4; removed. `contactPageOptionsSchema` (ipcSchemas.js:283, the `createCompanyPage` option flag) is already dead (defined + exported at line 550, never consumed by any handler); removed.

5. **Orphaned wiki-link helpers:** `VaultStructure.getContactWikiLink` (~573) and `getCompanyWikiLink` (~582) have zero callers in `src/` (grep confirms). They only produce `[[...]]`. Removed in Task 5.

6. **No template/VaultStructure unit tests exist** — glob of `tests/unit/**` shows none for `contactTemplate`, `companyTemplate`, or `VaultStructure`, and grep of `tests/**` for `contactTemplate|companyTemplate|createContactPage|createCompanyPage|autoCreateContact|slugify` returns nothing. So there are no tests to delete; Task 5 only deletes source modules.

7. **Slug behavior change (intentional):** `RoutingEngine._slugify` currently strips punctuation via `\w`-preserving regex (`J.D.` -> `jd`) AND truncates to 50 chars (`.substring(0, 50)`). The two `main.js` sites collapse punctuation to dashes (`J.D.` -> `j-d`) with NO truncation — which meant folder and file slugs could disagree on long titles even ignoring punctuation. The shared helper canonicalizes on the `jd` behavior (per spec) and caps at 80 chars (trailing dash trimmed) so both names stay bounded AND identical; the vault lives on a Windows share where unbounded folder+file slugs risk MAX_PATH.

8. **Empty-slug guard (defensive add):** the spec's `slugify` returns `''` for an all-punctuation title (e.g. `"!!!"`), which would yield a broken filename like `2026-07-10-.md`. The helper adds a trailing `|| 'meeting'` so any input that reduces to empty becomes `meeting`, honoring the spec's "falsy -> meeting" intent. Covered by a test case.

9. **Handler wrapper is `withValidation(schema, handler)`, not `createValidatedHandler`** — the task brief's name was approximate; the real wrapper is `withValidation`, imported in `src/main.js` at line ~118 and applied as `ipcMain.handle('name', withValidation(schema, fn))`.

10. **User-facing "Obsidian" rename is scoped to the Export/Publish action only.** `src/renderer.js` contains ~25 "Obsidian" strings, most describing SYNC STATUS ("Synced to Obsidian", "not synced to Obsidian", sync buttons/filters/counts). Per spec §3 (rename the export action) and Non-Goals (don't disturb sync-state semantics / internal identifiers), Task 6 renames ONLY the export/publish button labels and their success toasts. Sync-status vocabulary is left as-is and flagged for JD in Task 7.

11. **Ignore `.claude/worktrees/`** — grep surfaces many hits under `.claude/worktrees/`. Those are throwaway worktree copies (gitignored). Edit ONLY `src/...` paths.

12. **`docs/` is gitignored** — this plan file and any docs commit need `git add -f`.

---

## Task 1: Shared slugify helper + wire the three slug sites

**Files:**
- Create: `src/main/utils/slugify.js`
- Test: `tests/unit/slugify.test.js`
- Modify: `src/main/routing/RoutingEngine.js` (add require after line 9; line 48; `_slugify` body lines 143-151)
- Modify: `src/main.js` (add require after line 45; routingOverride slug lines 3792-3797; file slug lines 3850-3855)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/slugify.test.js`:

```js
import { describe, it, expect } from 'vitest';
import slugify from '../../src/main/utils/slugify.js';

describe('slugify', () => {
  it('strips periods so initials collapse (J.D. -> jd)', () => {
    expect(slugify('Stephanie Bucko and J.D. Bruce')).toBe('stephanie-bucko-and-jd-bruce');
  });

  it('strips apostrophes (O-Brien -> obrien)', () => {
    expect(slugify("O'Brien Sync")).toBe('obrien-sync');
    expect(slugify('O’Brien Sync')).toBe('obrien-sync');
  });

  it('returns "meeting" for an empty string', () => {
    expect(slugify('')).toBe('meeting');
  });

  it('returns "meeting" for null/undefined', () => {
    expect(slugify(null)).toBe('meeting');
    expect(slugify(undefined)).toBe('meeting');
  });

  it('trims edge junk and collapses interior runs', () => {
    expect(slugify('  --Weird__ Title!! ')).toBe('weird-title');
  });

  it('preserves numbers', () => {
    expect(slugify('Q4 2026 Review')).toBe('q4-2026-review');
  });

  it('returns "meeting" when the title reduces to empty', () => {
    expect(slugify('!!!')).toBe('meeting');
  });

  it('caps very long titles at 80 chars without a trailing dash', () => {
    const long = 'word '.repeat(40); // 200 chars of "word word word ..."
    const slug = slugify(long);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith('-')).toBe(false);
    expect(slug.startsWith('word-word')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/slugify.test.js`
Expected: FAIL — `Failed to resolve import "../../src/main/utils/slugify.js"` (file not created yet).

- [ ] **Step 3: Create the helper**

Create `src/main/utils/slugify.js`:

```js
/**
 * Convert a title to a URL/filesystem-friendly slug.
 *
 * Shared by RoutingEngine (folder slug) and the meeting export (file slug)
 * so folder and file names always agree.
 *
 * Rules: lowercase -> drop apostrophes/periods (J.D. -> jd, O'Brien -> obrien)
 * -> collapse every other non-alphanumeric run to a single dash -> trim edge
 * dashes -> cap at 80 chars (vault lives on a Windows share; the slug appears
 * in both the folder AND the file name, so unbounded slugs risk MAX_PATH).
 * Falsy input, or any input that reduces to empty, yields 'meeting'.
 *
 * @param {string} title
 * @returns {string}
 */
const MAX_SLUG_LENGTH = 80;

function slugify(title) {
  const slug = String(title || 'meeting')
    .toLowerCase()
    .replace(/['’.]/g, '') // J.D. -> jd, O'Brien -> obrien (straight + curly apostrophe)
    .replace(/[^a-z0-9]+/g, '-') // collapse everything else to dashes
    .replace(/^-+|-+$/g, '') // trim edge dashes
    .substring(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, ''); // no trailing dash after the cut
  return slug || 'meeting';
}

module.exports = slugify;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/slugify.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Wire RoutingEngine to the shared helper**

In `src/main/routing/RoutingEngine.js`, add the require. Current lines 8-9:

```js
const path = require('path');
const databaseService = require('../services/databaseService');
```

Replace with:

```js
const path = require('path');
const databaseService = require('../services/databaseService');
const slugify = require('../utils/slugify');
```

Then replace the `_slugify` method body. Current lines 139-151:

```js
  /**
   * Convert string to URL-friendly slug
   * @private
   */
  _slugify(text) {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50);
  }
```

Replace with:

```js
  /**
   * Convert string to URL-friendly slug (delegates to the shared helper so
   * folder and file names always agree).
   * @private
   */
  _slugify(text) {
    return slugify(text);
  }
```

Then fix the default at line 48. Current:

```js
    const titleSlug = this._slugify(meetingTitle || 'untitled-meeting');
```

Replace with (let the helper default to `meeting`; a literal `'untitled-meeting'` would otherwise slug to `untitled-meeting`):

```js
    const titleSlug = this._slugify(meetingTitle);
```

- [ ] **Step 6: Wire the two `src/main.js` slug sites**

In `src/main.js`, add the require. Current line 45:

```js
const RoutingEngine = require('./main/routing/RoutingEngine');
```

Replace with:

```js
const RoutingEngine = require('./main/routing/RoutingEngine');
const slugify = require('./main/utils/slugify');
```

Replace the routingOverride branch slug. Current lines 3790-3799:

```js
      const meetingDate = meeting.date ? new Date(meeting.date) : new Date();
      const dateStr = meetingDate.toISOString().split('T')[0];
      const titleSlug = meeting.title
        ? meeting.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        : 'meeting';
      const folderName = `${dateStr}-${titleSlug}`;
```

Replace with:

```js
      const meetingDate = meeting.date ? new Date(meeting.date) : new Date();
      const dateStr = meetingDate.toISOString().split('T')[0];
      const titleSlug = slugify(meeting.title);
      const folderName = `${dateStr}-${titleSlug}`;
```

Replace the file-slug site. Current lines 3848-3856:

```js
      const meetingDate = meeting.date ? new Date(meeting.date) : new Date();
      const dateStr = meetingDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const titleSlug = meeting.title
        ? meeting.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
        : 'meeting';
      let baseFilename = `${dateStr}-${titleSlug}`;
```

Replace with:

```js
      const meetingDate = meeting.date ? new Date(meeting.date) : new Date();
      const dateStr = meetingDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const titleSlug = slugify(meeting.title);
      let baseFilename = `${dateStr}-${titleSlug}`;
```

- [ ] **Step 7: Run lint**

Run: `npx eslint src/main/utils/slugify.js src/main/routing/RoutingEngine.js src/main.js tests/unit/slugify.test.js`
Expected: no output (zero errors, zero warnings).

- [ ] **Step 8: Run the full unit suite**

Run: `npx vitest run`
Expected: all prior tests pass PLUS the 7 new slugify tests. (Baseline was 307 passing; expect 314. A lone `wasapiCapture.test.js` EADDRINUSE failure is environmental — the dev app is running — not from this change.)

- [ ] **Step 9: Commit**

```bash
git add src/main/utils/slugify.js tests/unit/slugify.test.js src/main/routing/RoutingEngine.js src/main.js
git commit -m "feat(export): unify slug generation via shared slugify helper

Replaces three divergent slug sites (RoutingEngine._slugify + two
main.js inline slugs) with src/main/utils/slugify.js so meeting folder
and file names always agree. Canonicalizes on J.D. -> jd; empty titles
slug to 'meeting'.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: Plain names + relative links in meeting markdown

The generators `generateSummaryMarkdown` / `generateTranscriptMarkdown` live in `src/main.js` and are NOT exported; `src/main.js` boots Electron on require, so they cannot be unit-tested directly. Instead we add a deterministic **source-guard** test that reads `src/main.js` as text and asserts the wiki-link template literals are gone and the relative-link templates are present. This is a real, runnable regression guard that needs no Electron.

**Files:**
- Test: `tests/unit/meetingMarkdown.test.js`
- Modify: `src/main.js` (frontmatter participants ~4003-4005, ~4019-4020; company ~4062; transcript link ~4112; back link ~4136; participant list ~4153; speaker labels ~4173-4180)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/meetingMarkdown.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// vitest runs from the repo root
const mainSrc = readFileSync(path.resolve('src/main.js'), 'utf8');

describe('meeting markdown generation (source guard)', () => {
  it('emits no Obsidian wiki-link template literals', () => {
    // The interpolated wiki-link form must be gone everywhere.
    expect(mainSrc.includes('[[' + '${')).toBe(false);
  });

  it('links the summary to the transcript with a relative markdown link', () => {
    expect(mainSrc).toContain('[Transcript](./' + '${baseFilename}-transcript.md)');
  });

  it('links the transcript back to the summary with a relative markdown link', () => {
    expect(mainSrc).toContain('[Summary](./' + '${baseFilename}.md)');
  });
});
```

Note: the assertion strings are split with `+` only to keep this plan file's own linters quiet; the runtime comparison is exactly `[[` immediately followed by `${` etc.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/meetingMarkdown.test.js`
Expected: FAIL — the first assertion fails because `src/main.js` still contains the interpolated wiki-links, and the relative-link assertions fail because those strings don't exist yet.

- [ ] **Step 3: Plain names in frontmatter participants (legacy `participants` array)**

In `src/main.js`, current lines 4002-4005:

```js
      // Legacy format: wiki-links for backwards compatibility
      if (!participantNames.includes(`"[[${attendee.name}]]"`)) {
        participantNames.push(`"[[${attendee.name}]]"`);
      }
```

Replace with:

```js
      // Legacy format: plain quoted names (no wiki-links)
      if (!participantNames.includes(`"${attendee.name}"`)) {
        participantNames.push(`"${attendee.name}"`);
      }
```

- [ ] **Step 4: Plain names in the participantEmails fallback branch**

Current lines 4018-4020:

```js
        if (mapping && mapping.name) {
          const name = mapping.name.replace(/^\[\[|\]\]$/g, '');
          participantNames.push(`"[[${name}]]"`);
```

Replace with (keep the defensive strip of any incoming brackets, just emit a plain quoted name):

```js
        if (mapping && mapping.name) {
          const name = mapping.name.replace(/^\[\[|\]\]$/g, '');
          participantNames.push(`"${name}"`);
```

- [ ] **Step 5: Plain company name in frontmatter**

Current lines 4060-4064:

```js
  if (companyName) {
    markdown += `\n# Company linking\n`;
    markdown += `company: "[[${companyName}]]"\n`;
    markdown += `company_slug: "${companySlug}"\n`;
  }
```

Replace with:

```js
  if (companyName) {
    markdown += `\n# Company linking\n`;
    markdown += `company: "${companyName}"\n`;
    markdown += `company_slug: "${companySlug}"\n`;
  }
```

- [ ] **Step 6: Relative markdown link summary -> transcript**

Current line 4112:

```js
  markdown += `\n**Full Transcript:** [[${baseFilename}-transcript]]\n\n`;
```

Replace with:

```js
  markdown += `\n**Full Transcript:** [Transcript](./${baseFilename}-transcript.md)\n\n`;
```

- [ ] **Step 7: Relative markdown link transcript -> summary**

Current line 4136 (inside the transcript template literal):

```js
**Back to summary:** [[${baseFilename}]]
```

Replace with:

```js
**Back to summary:** [Summary](./${baseFilename}.md)
```

- [ ] **Step 8: Plain names in the transcript Participants list**

Current lines 4145-4154:

```js
  // Add speaker directory if we have participants with emails
  // CS-3.7: Use wiki-links for participant names to enable Obsidian backlinks
  if (meeting.participants && meeting.participants.length > 0) {
    const participantsWithEmail = meeting.participants.filter(p => p.email);
    if (participantsWithEmail.length > 0) {
      markdown += `## Participants\n\n`;
      participantsWithEmail.forEach(participant => {
        // Use wiki-link for participant name
        const nameLink = participant.name ? `[[${participant.name}]]` : 'Unknown';
        markdown += `- **${nameLink}**: ${participant.email}\n`;
      });
```

Replace with:

```js
  // Add speaker directory if we have participants with emails
  if (meeting.participants && meeting.participants.length > 0) {
    const participantsWithEmail = meeting.participants.filter(p => p.email);
    if (participantsWithEmail.length > 0) {
      markdown += `## Participants\n\n`;
      participantsWithEmail.forEach(participant => {
        // Plain participant name (no wiki-link)
        const displayName = participant.name || 'Unknown';
        markdown += `- **${displayName}**: ${participant.email}\n`;
      });
```

- [ ] **Step 9: Plain names in transcript speaker labels**

Current lines 4173-4180:

```js
          // CS-3.7: Use wiki-link for speaker name if it's a real name (not a speaker label)
          // This enables Obsidian backlinks - meetings will show up on contact pages
          const isRealName =
            segment.speakerName &&
            !segment.speakerName.match(/^(Speaker\s*[A-Z0-9]|SPK[-_]|spk_|SPEAKER_)/i);
          if (isRealName) {
            speaker = `[[${segment.speakerName}]]`;
          }
```

Replace with (keep the real-name detection but emit the plain name; `speaker` is already initialized to `segment.speakerName || segment.speaker || 'Speaker'` just above):

```js
          // Use the resolved speaker name (plain text, no wiki-link) when it's a
          // real name rather than a raw diarization label.
          const isRealName =
            segment.speakerName &&
            !segment.speakerName.match(/^(Speaker\s*[A-Z0-9]|SPK[-_]|spk_|SPEAKER_)/i);
          if (isRealName) {
            speaker = segment.speakerName;
          }
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npx vitest run tests/unit/meetingMarkdown.test.js`
Expected: PASS (3 tests) — no interpolated wiki-links remain and both relative-link strings are present.

- [ ] **Step 11: Run lint**

Run: `npx eslint src/main.js tests/unit/meetingMarkdown.test.js`
Expected: no output (zero errors/warnings). (`isRealName` is still consumed by the `if`, so no unused-var warning.)

- [ ] **Step 12: Commit**

```bash
git add src/main.js tests/unit/meetingMarkdown.test.js
git commit -m "feat(export): plain names and relative links in meeting markdown

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: Remove auto-create of contact/company pages

**Files:**
- Modify: `src/main.js` (delete the call ~line 3926-3927; delete the function ~lines 4207-4417)

- [ ] **Step 1: Delete the auto-create call inside `exportMeetingToObsidian`**

Current lines 3922-3927:

```js
    console.log(
      `[ObsidianExport] Successfully exported meeting to ${createdPaths.length} location(s)`
    );

    // CS-3.5/CS-3.6: Auto-create contact and company pages for participants
    await autoCreateContactAndCompanyPages(meeting, routes);
```

Replace with:

```js
    console.log(
      `[ObsidianExport] Successfully exported meeting to ${createdPaths.length} location(s)`
    );
```

- [ ] **Step 2: Delete the `autoCreateContactAndCompanyPages` function**

Delete the entire block, current lines 4207-4417 (the JSDoc comment through the closing brace and its trailing blank line). It starts at the JSDoc for `autoCreateContactAndCompanyPages(meeting, routes)` and ends at the function's final `return createdPages;` closing brace. The last lines of the block are the catch handler that logs `[AutoCreate] Error creating pages` and then `return createdPages;`.

Remove the whole function (leave one blank line between the preceding `generateTranscriptMarkdown` closing brace and the following `executeTemplateSectionTask` JSDoc).

- [ ] **Step 3: Verify no dangling references**

Run: `npx eslint src/main.js`
Expected: no output. (`databaseService`, `googleContacts`, `vaultStructure` are all used elsewhere.)

Run: `grep -rn "autoCreateContactAndCompanyPages" src/`
Expected: no matches.

- [ ] **Step 4: Run the full unit suite**

Run: `npx vitest run`
Expected: all tests pass (same count as end of Task 2). No test referenced this function.

- [ ] **Step 5: Commit**

```bash
git add src/main.js
git commit -m "refactor(export): remove auto-create of contact/company pages

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: Remove manual create-page IPC, preload, schemas, and renderer UI

Removes all four `contacts:*Page*` IPC handlers (create + exists, contact + company), all four preload bridges, the now-orphaned `contactSchema` + `contactPageOptionsSchema`, and the renderer UI in `contacts.js` and `meetingDetail.js` that offered manual page creation / existence display.

**Files:**
- Modify: `src/main.js` (IPC handlers ~5638-5712; `contactSchema` import ~168-169)
- Modify: `src/preload.js` (bridges ~177-185)
- Modify: `src/main/validation/ipcSchemas.js` (defs ~275-285; exports ~548-550)
- Modify: `src/renderer/contacts.js` (exists-checks ~499-520; obsidian section ~522-564, ~593-594; handlers ~604-614; functions ~799-916)
- Modify: `src/renderer/meetingDetail.js` (call ~751-752; function ~879-940)

- [ ] **Step 1: Delete the four IPC handlers in `src/main.js`**

Delete current lines 5638-5712 — the block from the `contacts:createContactPage` comment through the closing `);` of the `contacts:companyPageExists` handler. It contains four `ipcMain.handle(...)` registrations: `contacts:createContactPage` and `contacts:createCompanyPage` (both wrapped `withValidation(contactSchema, ...)`, each calling `vaultStructure.createContactPage` / `createCompanyPage`), plus `contacts:contactPageExists` and `contacts:companyPageExists` (both wrapped `withValidation(stringIdSchema, ...)`, each calling `vaultStructure.contactPageExists` / `companyPageExists`). Delete all four. Leave the preceding `contacts:getMeetingsForContact` handler and the following `// Match speakers to participants` block intact, separated by one blank line.

- [ ] **Step 2: Remove the orphaned `contactSchema` import in `src/main.js`**

Current lines 168-169 (inside the ipcSchemas destructure):

```js
  // Contact schemas
  contactSchema,
```

Delete both lines. `contactSchema` had no other consumer.

- [ ] **Step 3: Remove the four preload bridges**

In `src/preload.js`, current lines 177-185:

```js
  // CS-3: Contact/Company Page Management
  contactsCreateContactPage: (contact, options) =>
    ipcRenderer.invoke('contacts:createContactPage', contact, options),
  contactsContactPageExists: contactName =>
    ipcRenderer.invoke('contacts:contactPageExists', contactName),
  contactsCreateCompanyPage: (company, options) =>
    ipcRenderer.invoke('contacts:createCompanyPage', company, options),
  contactsCompanyPageExists: companyName =>
    ipcRenderer.invoke('contacts:companyPageExists', companyName),
```

Delete all nine lines (comment + four bridge methods). The preceding `contactsGetMeetingsForContact` entry and the following `contactsRematchParticipants` entry remain.

- [ ] **Step 4: Remove the orphaned schemas in `src/main/validation/ipcSchemas.js`**

Delete the definitions. Current lines 275-285:

```js
// Contact-related schemas
const contactSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  company: z.string().optional(),
  phone: z.string().optional(),
});

const contactPageOptionsSchema = z.object({
  createCompanyPage: z.boolean().optional(),
}).optional();
```

Remove all 11 lines (including the `// Contact-related schemas` comment); leave one blank line before the `// Settings/config schemas` section.

Then remove them from the module exports. Current lines 548-550:

```js
  // Contact schemas
  contactSchema,
  contactPageOptionsSchema,
```

Delete all three lines. The preceding `hoursAheadSchema,` and the following `// Settings/config schemas` remain.

- [ ] **Step 5: Remove the Obsidian section from `contacts.js` renderer**

In `src/renderer/contacts.js`, delete the existence checks. Current lines 499-520:

```js
  // Check if Obsidian pages exist
  let contactPageExists = false;
  let companyPageExists = false;

  try {
    const contactResult = await window.electronAPI.contactsContactPageExists(contact.name);
    contactPageExists = contactResult.success && contactResult.exists;
  } catch (error) {
    console.warn('[Contacts] Could not check Obsidian contact page status:', error);
  }

  // Check company page if organization exists
  if (contact.organization) {
    try {
      const companyResult = await window.electronAPI.contactsCompanyPageExists(
        contact.organization
      );
      companyPageExists = companyResult.success && companyResult.exists;
    } catch (error) {
      console.warn('[Contacts] Could not check Obsidian company page status:', error);
    }
  }
```

Delete all 22 lines.

Then delete the two HTML builders and the actions wrapper (current lines 522-564): the `const contactPageHtml = contactPageExists ? ... : ...;` ternary (which produces the "Create Contact Page" button with id `createObsidianPageBtn`), the `let companyPageHtml = '';` plus `if (contact.organization) { companyPageHtml = ... }` block (which produces the "Create Company Page" button with id `createCompanyPageBtn`), and the `const obsidianActionsHtml = ...` template that wraps them in an `<h4>Obsidian</h4>` section. Delete all of lines 522-564.

Then remove the section from the rendered template. Current lines 593-594 (the `${obsidianActionsHtml}` interpolation inside the contact-detail render template and its preceding blank line):

```
    ${obsidianActionsHtml}
```

Delete those two lines so the Contact Information section is followed directly by the `contactMeetingsSection` block. No new markup is added, so the security createElement/textContent rule is not triggered.

Then remove the two button click handlers. Current lines 604-614:

```js
  // Add click handler for create contact page button
  const createPageBtn = document.getElementById('createObsidianPageBtn');
  if (createPageBtn) {
    createPageBtn.addEventListener('click', () => createContactObsidianPage(contact));
  }

  // Add click handler for create company page button
  const createCompanyBtn = document.getElementById('createCompanyPageBtn');
  if (createCompanyBtn) {
    createCompanyBtn.addEventListener('click', () => createCompanyObsidianPage(contact));
  }
```

Delete all 11 lines. The following `// v1.4: Edit contact button` handler remains.

- [ ] **Step 6: Delete the two create-page functions in `contacts.js`**

Delete `createContactObsidianPage` and `createCompanyObsidianPage` (current lines ~799-916), including their preceding JSDoc comment blocks. The first begins `async function createContactObsidianPage(contact) {`; the block ends at the closing brace of `createCompanyObsidianPage`, immediately before the `getInitials(name)` function. Leave `getInitials` intact. Both functions only set button loading state and call the now-removed `contactsCreateContactPage` / `contactsCreateCompanyPage` bridges.

- [ ] **Step 7: Remove `renderObsidianLinksSection` and its call in `meetingDetail.js`**

In `src/renderer/meetingDetail.js`, delete the call. Current lines 751-752:

```js
  // Obsidian Links Section
  sections.push(renderObsidianLinksSection(participant));
```

Delete both lines. The `container.innerHTML = sections.filter(Boolean).join('');` line below remains; `sections` still holds the other pushed sections.

Then delete the entire `renderObsidianLinksSection` function (current lines 879-940), from its JSDoc through the closing brace that returns the `expanded-section-group` markup titled `Obsidian Vault`. This is the block that builds the `obsidian-link-check` spans, checks existence via `contactsContactPageExists` / `contactsCompanyPageExists`, and wires the `create-obsidian-page-btn` click to `contactsCreateContactPage` / `contactsCreateCompanyPage`. The following `Handle Add to Google Contacts button click` function remains.

- [ ] **Step 8: Verify no dangling references**

Run: `grep -rn "contactsCreateContactPage\|contactsCreateCompanyPage\|contactsContactPageExists\|contactsCompanyPageExists\|createObsidianPageBtn\|createCompanyPageBtn\|renderObsidianLinksSection\|obsidian-link-check\|create-obsidian-page-btn\|contactSchema\|contactPageOptionsSchema" src/`
Expected: no matches.

- [ ] **Step 9: Run lint**

Run: `npx eslint src/`
Expected: no output (zero errors/warnings). `escapeHtml` is still used elsewhere in `contacts.js`; `stringIdSchema` is still used by many other handlers.

- [ ] **Step 10: Run the full unit suite**

Run: `npx vitest run`
Expected: all tests pass (same count as Task 3).

- [ ] **Step 11: Commit**

```bash
git add src/main.js src/preload.js src/main/validation/ipcSchemas.js src/renderer/contacts.js src/renderer/meetingDetail.js
git commit -m "refactor(contacts): remove manual contact/company page creation UI + IPC

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 5: Delete VaultStructure page methods, wiki-link helpers, and the template modules

**Files:**
- Modify: `src/main/storage/VaultStructure.js` (section header ~440-442; methods ~449-566; wiki-link helpers ~568-584)
- Delete: `src/main/templates/contactTemplate.js`
- Delete: `src/main/templates/companyTemplate.js`

- [ ] **Step 1: Confirm the template modules have no other importers**

Run: `grep -rn "contactTemplate\|companyTemplate" src/`
Expected: matches ONLY inside `src/main/storage/VaultStructure.js` (the lazy `require`s inside the methods being deleted this task). No other file imports them.

- [ ] **Step 2: Delete the four page methods from `VaultStructure.js`**

Delete current lines 449-566 — the block containing `contactPageExists`, `createContactPage`, `companyPageExists`, and `createCompanyPage` (including the JSDoc comment above each). `contactPageExists` / `createContactPage` lazily `require('../templates/contactTemplate.js')` for `generateContactFilename` / `generateContactPage`; `companyPageExists` / `createCompanyPage` lazily `require('../templates/companyTemplate.js')` for `generateCompanyFilename` / `generateCompanyPage`. Deleting these methods removes the only importers of those template modules.

Also delete the now-empty section header. Current lines 440-442:

```js
  // =================================================================
  // CS-3: Contact/Company Page Management
  // =================================================================
```

Delete those three lines.

- [ ] **Step 3: Delete the orphaned wiki-link helpers**

Current lines 568-584:

```js
  /**
   * Get the wiki-link for a contact
   * @param {string} contactName - Contact name
   * @returns {string} Wiki-link syntax
   */
  getContactWikiLink(contactName) {
    return `[[${contactName}]]`;
  }

  /**
   * Get the wiki-link for a company
   * @param {string} companyName - Company name
   * @returns {string} Wiki-link syntax
   */
  getCompanyWikiLink(companyName) {
    return `[[${companyName}]]`;
  }
```

Delete all 17 lines. Zero callers exist in `src/`. The following `// RS-2: Stale Link Detection & Refresh` section remains.

- [ ] **Step 4: Delete the two template modules**

```bash
git rm src/main/templates/contactTemplate.js src/main/templates/companyTemplate.js
```

- [ ] **Step 5: Verify no dangling references**

Run: `grep -rn "generateContactPage\|generateCompanyPage\|generateContactFilename\|generateCompanyFilename\|getContactWikiLink\|getCompanyWikiLink\|contactTemplate\|companyTemplate\|\.createContactPage\|\.createCompanyPage\|\.contactPageExists\|\.companyPageExists" src/`
Expected: no matches.

- [ ] **Step 6: Run lint**

Run: `npx eslint src/`
Expected: no output (zero errors/warnings).

- [ ] **Step 7: Run the full unit suite**

Run: `npx vitest run`
Expected: all tests pass (same count as Task 4). No tests referenced these modules or methods.

- [ ] **Step 8: Commit**

```bash
git add src/main/storage/VaultStructure.js
git commit -m "refactor(vault): delete contact/company page methods and templates

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 6: Rename user-facing "Export/Publish to Obsidian" -> "... to Vault"

Scoped to the export/publish ACTION labels and their success toasts only. Sync-status vocabulary ("Synced to Obsidian", "not synced", sync buttons/filters) and internal identifiers (`obsidianLink`, `exportMeetingToObsidian`, the `exportToObsidianBtn` element id, `[ObsidianExport]` logs) are intentionally left — see Task 7 for the JD confirmation note.

**Files:**
- Modify: `src/index.html` (line 390; line 708; line 715)
- Modify: `src/renderer.js` (line 745; lines 2518, 2521; line 6525; line 7331)

- [ ] **Step 1: Rename the batch-export button label in `index.html`**

Current line 390 (inside the button with id `batchExportBtn`) reads `Export to Obsidian`. Change it to `Export to Vault`. Line 708 is an identical string — use the `batchExportBtn` context to target this one only.

- [ ] **Step 2: Rename the meeting-detail export button label in `index.html`**

Current line 708 (inside the button with id `exportToObsidianBtn`) reads `Export to Obsidian`. Change it to `Export to Vault`.

- [ ] **Step 3: Rename the publish button default text in `index.html`**

Current line 715:

```html
              <span id="obsidianButtonText">Publish to Obsidian</span>
```

Replace with:

```html
              <span id="obsidianButtonText">Publish to Vault</span>
```

- [ ] **Step 4: Rename the batch-export success alert in `renderer.js`**

Current line 745:

```js
  alert(`Exported ${successCount} of ${selectedIds.length} meetings to Obsidian`);
```

Replace with:

```js
  alert(`Exported ${successCount} of ${selectedIds.length} meetings to Vault`);
```

- [ ] **Step 5: Rename the dynamic publish button text in `renderer.js`**

Current lines 2517-2523:

```js
    if (meeting.obsidianLink) {
      obsidianButtonText.textContent = 'Republish to Obsidian';
      obsidianButton.classList.add('published');
    } else {
      obsidianButtonText.textContent = 'Publish to Obsidian';
      obsidianButton.classList.remove('published');
    }
```

Replace with:

```js
    if (meeting.obsidianLink) {
      obsidianButtonText.textContent = 'Republish to Vault';
      obsidianButton.classList.add('published');
    } else {
      obsidianButtonText.textContent = 'Publish to Vault';
      obsidianButton.classList.remove('published');
    }
```

- [ ] **Step 6: Rename the summary-generation export toast in `renderer.js`**

Current line 6525:

```js
        const exportStatus = result.exported ? ' and exported to Obsidian' : '';
```

Replace with:

```js
        const exportStatus = result.exported ? ' and exported to Vault' : '';
```

- [ ] **Step 7: Rename the publish success toast in `renderer.js`**

Current line 7331:

```js
          const message = isRepublish ? 'Republished to Obsidian!' : 'Published to Obsidian!';
```

Replace with:

```js
          const message = isRepublish ? 'Republished to Vault!' : 'Published to Vault!';
```

- [ ] **Step 8: Verify the intended scope**

Run: `grep -rn "Export to Obsidian\|Publish to Obsidian\|Republish to Obsidian\|Published to Obsidian\|exported to Obsidian\|meetings to Obsidian" src/index.html src/renderer.js`
Expected: no matches (all export/publish action strings renamed).

Run: `grep -rn "Synced to Obsidian\|synced to Obsidian\|Sync to Obsidian" src/renderer.js`
Expected: matches STILL present — these sync-status strings are intentionally retained (report count to JD in Task 7).

- [ ] **Step 9: Run lint**

Run: `npx eslint src/renderer.js`
Expected: no output.

- [ ] **Step 10: Run the full unit suite**

Run: `npx vitest run`
Expected: all tests pass (same count as Task 5). String-literal edits with no test coverage.

- [ ] **Step 11: Commit**

```bash
git add src/index.html src/renderer.js
git commit -m "feat(ui): rename Export/Publish to Obsidian -> to Vault

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 7: Final verification, lint, full suite, and manual E2E checklist

**Files:** none (verification only, plus committing this plan doc).

- [ ] **Step 1: Full lint over the whole source tree**

Run: `npx eslint src/`
Expected: no output (zero errors, zero warnings).

- [ ] **Step 2: Full unit suite**

Run: `npx vitest run`
Expected: all tests green. Baseline was 307; this plan adds `tests/unit/slugify.test.js` (7) and `tests/unit/meetingMarkdown.test.js` (3) -> 317 passing. A lone `wasapiCapture.test.js` EADDRINUSE failure is environmental (dev app running) — quit it and re-run.

- [ ] **Step 3: Global grep sweep for leftover CRM-page references**

Run: `grep -rn "autoCreateContactAndCompanyPages\|createContactPage\|createCompanyPage\|contactPageExists\|companyPageExists\|contactTemplate\|companyTemplate\|getContactWikiLink\|getCompanyWikiLink\|contactSchema\|contactPageOptionsSchema" src/`
Expected: no matches.

Confirm no interpolated wiki-links remain in the export markdown:
Run: `grep -rn "Full Transcript:.*\[\[\|Back to summary:.*\[\[" src/main.js`
Expected: no matches.

- [ ] **Step 4: Manual E2E checklist (JD runs the dev app)**

Quit the installed app first (dev + installed both log to the same file). Then `npm start` and:

1. Open a meeting with generated summaries. The button reads **Export to Vault** (meeting detail) / **Publish to Vault** (publish button); batch mode reads **Export to Vault**.
2. Click Export/Publish. Confirm the success toast reads **Published to Vault!** (or Republished to Vault!).
3. In the routed folder (e.g. `I:\Shared drives\Clients\...`) confirm EXACTLY two files: `YYYY-MM-DD-<slug>.md` and `YYYY-MM-DD-<slug>-transcript.md`, and that the folder slug and file slug MATCH (test a punctuated title like "Stephanie Bucko and J.D. Bruce" -> both `...and-jd-bruce`).
4. Open the summary `.md`: frontmatter `participants:` and `company:` are plain quoted names (no double square brackets); body participant names are plain; the Full Transcript line renders as a clickable relative link to the transcript.
5. Open the transcript `.md`: the Back to summary line is a relative link; speaker labels are plain names; the Participants list has no double square brackets.
6. Confirm NO new files appear under the vault `People/` or `Companies/` folders.
7. Open the Contacts view and a contact detail panel: contact info + meeting history still render, but the Obsidian create-page section is gone. Open a meeting participant card: no Create Contact Page / Obsidian Vault section.

- [ ] **Step 5: Report the retained sync-status strings to JD**

Note for JD: the following user-facing SYNC-STATUS strings were intentionally left as "Obsidian" (out of this divorce scope, tied to `obsidianLink` sync-state): "Synced to Obsidian" (status option / detail badge), "Not Synced to Obsidian" (filter + view), sync button tooltips ("Sync to Obsidian", "Sync all unsynced meetings to Obsidian"), the "Auto-export to Obsidian vault" settings label, and the "Meeting synced to Obsidian!" toast. Ask whether these should also become "Vault" in a follow-up.

- [ ] **Step 6: Commit this plan document (docs/ is gitignored -> use -f)**

```bash
git add -f docs/superpowers/plans/2026-07-10-vault-export-divorce.md
git commit -m "docs: add vault export divorce implementation plan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage** (spec sections 1-6):
- Section 1 Remove page creation — Task 3 (auto + call), Task 4 (manual IPC/preload/schemas/renderer), Task 5 (VaultStructure methods + templates). Extended to also remove `*PageExists` (Finding 3) and orphaned schemas/helpers (Findings 4-5). Covered.
- Section 2 Plain names + relative links — Task 2 (all six sites: frontmatter participants x2, company, transcript link, back link, participant list, speaker labels). Covered.
- Section 3 User-facing rename — Task 6 (export/publish labels + toasts). Covered.
- Section 4 Unified slug — Task 1 (helper + RoutingEngine + two main.js sites; `untitled-meeting` -> `meeting`). Covered.
- Section 5 What stays untouched — routing, Google Contacts, two-file architecture, auto-export trigger untouched; only labels change. Covered.
- Section 6 Testing — `slugify` unit tests, markdown source-guard test, full suite green, zero lint. Confirmed no template/VaultStructure tests to update/delete (Finding 6). Covered.

**Placeholder scan:** No TBD / "similar to Task N" / vague steps. Every code step shows the actual current code and its replacement; every command shows expected output.

**Type consistency:** `slugify` is a single default export used identically in RoutingEngine (`require('../utils/slugify')`) and main.js (`require('./main/utils/slugify')`). `baseFilename` in the relative-link templates matches the existing variable in `generateSummaryMarkdown` / `generateTranscriptMarkdown`. Handler wrapper name `withValidation` matches the real code (Finding 9).
