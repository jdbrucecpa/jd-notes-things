# v1.4.8 Release Notes

## Highlights
Fixes a Settings → Clients bug where the "+ Add Company" button silently failed: clicking a company in the picker appeared to do nothing because the new row was filtered out of the rendered table.

---

## Client Management Fix

- **"+ Add Company" now prompts for a vault folder before saving**: Previously the picker click handler called `companiesUpdate` with `vaultPath: ''`. The empty string was coerced to `null` by `clientService.createClient` (line 53: `vaultPath || null`), and the table render in `renderClientsTab` filters by truthy `vaultPath` (line 1522), so the new row was created in the database but never displayed. The handler now opens the folder picker first and only writes the company record after a folder is chosen — matching the existing Browse-button pattern. If the user cancels the folder dialog, no orphaned DB row is created.

- **Auto-sync of Google Contacts now triggers on add**: The `if (vaultPath && googleContacts)` guard in the `companies:update` IPC handler was previously skipped because of the empty-string vault path. With a real folder path on first save, Google Contacts auto-sync now runs the way it does for the Browse-button flow.

---

## Files Changed
3 files changed, 5 insertions(+), 3 deletions(-) in `src/renderer/settings.js`, `package.json`, and `src/index.html`.
