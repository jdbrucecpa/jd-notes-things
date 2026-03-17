# v1.4.1 Release Notes

## Highlights

Patch release fixing a routing bug that prevented meetings from exporting to Obsidian vaults on shared or network drives.

---

## Routing Path Validation Fix

- **Shared drive exports now work**: The v1.4.0 routing revamp added a security check that required all absolute export paths to be under the user's home directory (`C:\Users\...`). This broke routing for companies whose `vault_path` pointed to shared drives (e.g., `H:\Shared drives\Clients\...`) or any non-C: drive. The validation now uses a blocklist of dangerous Windows system directories (`C:\Windows`, `C:\Program Files`, etc.) instead of a home-directory allowlist, preserving security while supporting all legitimate vault locations.

---

## Files Changed

3 files changed, ~13 additions, ~7 deletions (net +6 lines)
