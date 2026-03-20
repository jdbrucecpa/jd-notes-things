# v1.4.5 Release Notes

## Highlights
Fixes summary generation saving files to `_unfiled` instead of the correct client folder, and removes all dead routing.yaml code now that routing is fully database-driven.

---

## Routing Bug Fixes

- **Stale obsidianLink bypass**: When generating summaries, the export was reusing a cached `obsidianLink` from a prior auto-export (often `_unfiled` from before participant data was available) instead of re-routing via the routing engine. Template generation now forces fresh routing, so the file goes where the preview says it will.

- **Manual destination selection fixed**: `getDestinations()` was returning `id`/`vaultPath` properties but the renderer expected `slug`/`path`, causing the dropdown to produce empty values. Also fixed Industry-category clients being grouped as "Other" instead of "Industry".

- **Consistent folder structure**: Manual destination selection was adding a `/meetings/` subfolder that auto-routing did not, causing inconsistent paths. Both now use the same convention: `{vault_path}/{date-title-slug}/`.

## YAML-to-Database Migration

- **Create New Organization**: The "Create New Organization" flow in the Generate Summaries dialog was writing to `routing.yaml` (which the routing engine no longer reads). Now creates clients in the SQLite database via `clientService`.

- **Add Routing Rule (domains)**: The "Add domains to organization" flow was also writing to YAML. Now updates the `domains` JSON column in the `clients` table.

- **Unmatched domain detection**: The prompt that detects unmatched participant email domains was reading from `routing.yaml` to find existing mappings. Now reads from the database via a new `routing:getAllMappedDomains` IPC handler.

- **Vocabulary client slugs**: The vocabulary client selector was reading slugs from `routing.yaml`. Now reads active client IDs from the database.

## Dead Code Removal

- **Removed `ConfigLoader.js`** and **`EmailMatcher.js`** — orphaned since v1.4 moved to database-driven routing (543 lines).
- **Removed `config/routing.yaml`** — bundled template file no longer needed (133 lines).
- **Removed 5 dead IPC handlers**: `routing:getConfig`, `routing:saveConfig`, `routing:validateConfig`, `routing:deleteOrganization`, `routing:restoreBackup`.
- **Removed stale preload bridges** for the deleted handlers.
- **Removed routing.yaml from settings export** service.

---

## Files Changed
13 files changed, ~83 additions, ~1060 deletions (net -977 lines)
