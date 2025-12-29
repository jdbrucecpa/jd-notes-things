# JD Notes Things v1.2.2 Release Notes

**Release Date:** December 2025

This release focuses on bug fixes and improvements to calendar display, participant matching, and template management.

---

## Bug Fixes

### Calendar UI Improvements

- **Fixed:** Calendar meetings now display all timed events (previously required attendees or meeting links)
- **Fixed:** Future meetings are now grouped by day (Today, Tomorrow, etc.) matching past meetings
- **Fixed:** "Invalid Date" header no longer appears due to property name mismatch

### Template Management

- **Added:** Refresh button to reload templates from disk without restarting the app
- **Added:** Copy button on each generated template summary for easy clipboard access
- **Fixed:** Template text is now selectable (was blocked by drag-and-drop handling)
- **Fixed:** Deleting template sections now properly persists to disk

### Participant & Contact Matching

- **Fixed:** Contact matching no longer incorrectly matches first-name-only when source has full name (e.g., "Tim Peyser" no longer matches "Tim Rasmussen")
- **Added:** `originalName` field to preserve immutable Zoom SDK participant names
- **Added:** Refresh participant matching button to re-match contacts without corrupting original names
- **Improved:** Participant data model now separates authoritative data (names from Zoom) from inferred data (emails from contact matching)

### Recording Timer

- **Fixed:** Timer now starts when joining via Zoom button (was only working for direct recordings)
- **Added:** Recording timer display in main app header (in addition to floating widget)
- **Fixed:** Refresh button spinner now properly stops after completion

### UI/UX Improvements

- **Improved:** Radio button styling for Replace/Append mode selection (better visual distinction)
- **Fixed:** Link colors in dark mode now use readable blue instead of hard-to-see dark blue

---

## Technical Changes

### Participant Data Model (Breaking Change for Plugins)

Participant objects now include an `originalName` field that preserves the original Zoom display name:

```javascript
{
  id: string,           // SDK participant ID
  originalName: string, // IMMUTABLE - original Zoom display name
  name: string,         // Display name (may be updated by contact matching)
  email: string|null,   // INFERRED from contact matching
  organization: string|null,
  isHost: boolean,
  platform: string,
  joinTime: string,
}
```

**Key Principle:** Names from Zoom SDK are authoritative. Emails are always inferred from contact matching and may be incorrect.

---

## Upgrade Notes

- No configuration changes required
- All v1.2.1 settings and data are fully compatible
- Existing meetings will not have `originalName` field (only new recordings)

---

## Requirements

- Windows 10/11 (64-bit)
- Node.js 20+ (for development)
