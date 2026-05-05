# v1.4.9 Release Notes

## Highlights
Fixes a routing-cache bug in the standalone "Export to Obsidian" button: a meeting that exported once to `_unfiled/` (e.g. before its client was configured) was permanently stuck there because subsequent Export clicks reused the cached path instead of re-evaluating routing. Also adds detailed routing diagnostics so it's clear from the dev console why a participant did or didn't match a client.

---

## Routing Fix

- **Manual Export now re-evaluates routing every click**: Previously, the `obsidian:exportMeeting` IPC handler called `exportMeetingToObsidian(meeting)` with no options. Inside the export function, `if (meeting.obsidianLink && !options.forceReroute)` short-circuits to the cached path. The Generate flow (auto-export after template generation) already passed `{ forceReroute: true }`; the standalone Export button did not. As a result, once a meeting had been exported to `_unfiled/`, adding the relevant client and clicking Export again silently re-wrote to the same `_unfiled/` location instead of routing to the now-configured client. Fixed by passing `{ forceReroute: true }` from `obsidian:exportMeeting` so newly added clients/folders take effect on the next Export.

---

## Diagnostics

- **Routing engine now logs match decisions per participant**: `RoutingEngine.route()` now emits a per-participant log line showing whether the org-name match path or the email-fallback path succeeded, and if not, why (no organization field, no matching client, vault_path empty, etc.). Useful for diagnosing why a meeting routes to `_unfiled/` when a client is configured.

---

## Files Changed
4 files changed, 49 insertions(+), 12 deletions(-) in `src/main.js`, `src/main/routing/RoutingEngine.js`, `package.json`, and `src/index.html`.
