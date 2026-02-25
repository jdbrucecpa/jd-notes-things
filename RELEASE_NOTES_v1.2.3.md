# v1.2.3 Release Notes

## Highlights

CRM Integration Phase 1 — frontmatter standardization. This release enriches meeting note frontmatter with structured participant data from Google Contacts, adding `googleContactId` linking, structured `attendees` arrays, and company resolution from `routing.yaml`. This lays the groundwork for obsidian-crm plugin integration.

---

## CRM Phase 1: Frontmatter Standardization

- **Structured attendees array**: YAML frontmatter `attendees` field upgraded from flat name list to structured objects with `name`, `email`, `google_contact_id`, and `organization`. Legacy `participants`/`participant_emails` arrays preserved for backwards compatibility.
- **Google Contact ID enrichment**: `populateParticipantsFromSpeakerMapping()` now attaches `googleContactId` (the Google People API `resourceName`) to each participant matched via `googleContacts.findContactByEmail()`.
- **Robust enrichment at export**: `exportMeetingToObsidian()` performs a second-pass enrichment — any participant with an email but missing `googleContactId` gets a cache lookup via `googleContacts.findContactByEmail()`, ensuring contact IDs are captured even when the initial speaker matching path didn't provide them.
- **Company linking from routing config**: `generateSummaryMarkdown()` now accepts a `route` parameter and resolves company name/slug from `routingEngine.getConfig()` for `client` and `industry` route types, embedding `company` and `company_slug` in frontmatter.
- **Meeting type detection**: Frontmatter `meeting_type` is now set to `internal` or `external` based on route type, replacing the previous hardcoded `"external"` value.
- **Summary placeholder filtering**: Attendees named "Summary" (placeholder entries) are now filtered out of the structured attendees array.

## Other Changes

- **Push-release command**: Added `.claude/commands/push-release.md` for streamlined release workflow automation.

---

## Files Changed

5 files changed, +258 insertions, -32 deletions
