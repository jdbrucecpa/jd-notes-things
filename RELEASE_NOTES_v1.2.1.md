# JD Notes Things v1.2.1 Release Notes

**Release Date:** December 2025

This is a maintenance release with a UI fix for the double scrollbar issue.

---

## Bug Fixes

### Double Scrollbar Fix

**Fixed:** Eliminated the extra scrollbar that appeared on the right edge of the main window.

**Root Cause:** Both the `html` and `body` elements were independently scrollable, causing two overlapping scrollbars to appear.

**Solution:** Added explicit overflow handling to ensure only the `body` element scrolls:
- `html { overflow: hidden; height: 100%; }`
- `body { overflow-y: auto; height: 100%; }`

---

## Upgrade Notes

- No configuration changes required
- All v1.2.0 settings and data are fully compatible

---

## Requirements

- Windows 10/11 (64-bit)
- Node.js 20+ (for development)
