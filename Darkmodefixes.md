# Dark Mode Color Fixes - Technical Debt

**Status:** Identified, Not Fixed
**Date:** 2025-01-16
**Total Issues:** 172 hardcoded color values breaking dark mode

## Overview

During dark mode testing, we discovered 172 instances of hardcoded color values in `src/index.css` that don't respect the dark theme. These should be replaced with CSS variables defined in the `:root` and `body.dark-theme` selectors.

## CSS Variable Reference

### Available Variables
```css
/* Light Theme (default) */
:root {
  --primary-bg: #f9f9f9;
  --card-bg: #fff;
  --light-purple: #f3e9ff;
  --light-green: #e8f5e9;
  --border-color: #e0e0e0;
  --text-primary: #000;
  --text-secondary: #666;
  --bg-primary: #f9f9f9;
  --bg-secondary: #f0f0f0;
  --card-hover: #f5f5f5;
  --primary-color: #007aff;
}

/* Dark Theme */
body.dark-theme {
  --primary-bg: #1e1e1e;
  --card-bg: #2d2d2d;
  --light-purple: #3a2a4a;
  --light-green: #2a3a2a;
  --border-color: #404040;
  --text-primary: #e0e0e0;
  --text-secondary: #a0a0a0;
  --bg-primary: #1e1e1e;
  --bg-secondary: #252525;
  --card-hover: #353535;
  --primary-color: #0a84ff;
}
```

## Critical Issues (User-Reported)

### 1. Search Bar Background
**Line 117**
```css
.search-input {
  background-color: #f2f2f2; /* ❌ Hardcoded */
}
```
**Fix:**
```css
.search-input {
  background-color: var(--bg-secondary); /* ✅ Variable */
}
```

### 2. Scrollbar Styling
**Missing entirely** - Browser defaults don't respect dark mode

**Fix needed:**
```css
/* Webkit scrollbars (Chrome, Safari, Edge) */
::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}

::-webkit-scrollbar-track {
  background: var(--bg-primary);
}

::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 6px;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--text-secondary);
}

/* Firefox scrollbars */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border-color) var(--bg-primary);
}
```

### 3. Refresh Button & Other Icon Buttons
**Lines 223, 253, 274, 311**
```css
.settings-btn { background-color: #f5f5f5; }
.debug-btn { background-color: #f5f5f5; }
.export-btn { background-color: #f5f5f5; }
.import-btn:hover { background-color: #f5f5f5; }
```
**Fix:**
```css
.settings-btn { background-color: var(--card-hover); }
.debug-btn { background-color: var(--card-hover); }
.export-btn { background-color: var(--card-hover); }
.import-btn:hover { background-color: var(--card-hover); }
```

## Button Issues (20+ instances)

### New Note & Join Meeting Buttons (Lines 164, 179)
```css
.new-note-btn {
  background: linear-gradient(135deg, #434343 0%, #000000 100%); /* ❌ */
}

.join-meeting-btn {
  background: linear-gradient(135deg, #4a6fa5 0%, #2e5c8a 100%); /* ❌ */
}

.join-meeting-btn:disabled {
  background: linear-gradient(135deg, #cbd5e1 0%, #94a3b8 100%); /* ❌ */
}
```

**Note:** Gradients are tricky - may need to define separate gradient variables or use solid colors with CSS variables.

## Meeting Card Issues (15+ instances)

### Lines 380-451
```css
.meeting-card {
  background-color: #F8F8F8; /* Should be var(--card-bg) */
}

.meeting-card.active {
  background-color: #F0F0F0; /* Should be var(--bg-secondary) */
}

.meeting-card:hover {
  background-color: #F5F5F5; /* Should be var(--card-hover) */
}

.meeting-card.upcoming {
  background-color: #E3F2FD; /* Should be var(--light-purple) or new variable */
}
```

## Modal & Panel Issues (25+ instances)

### Lines 751, 776, 885, 933
```css
.template-item {
  background-color: white; /* Should be var(--card-bg) */
}

.template-item.selected {
  background-color: white; /* Should be var(--card-bg) */
}

.modal-footer {
  background-color: white; /* Should be var(--card-bg) */
}

.checkbox-label {
  background-color: white; /* Should be var(--card-bg) */
}
```

## Calendar Colors (30+ instances)

### Lines 894-1012
Multiple hardcoded colors for:
- Event backgrounds (purple, green gradients)
- Time slot backgrounds
- Recording status indicators
- Hover states

**Examples:**
```css
Line 894:  background: #f5f5f5;
Line 910:  background-color: #eaeaea;
Line 928:  background-color: #ff3b30;
Line 942:  background-color: #e0e0e0;
Line 950:  background: linear-gradient(90deg, #6947bd, #8b5cf6);
Line 968:  background: #e3f3f1;
Line 978:  background: #f3e8ff;
Line 988:  background: #e9d5ff;
Line 993:  background: #d1fae5;
Line 997:  background: #a7f3d0;
Line 1012: background: #059669;
Line 1028: background-color: #d1eae7;
```

**Note:** Calendar may need additional CSS variables for:
- Event type colors (meeting, break, focus)
- Recording status colors
- Time slot states

## Debug Panel Issues (Lines 1064-1362)

The debug panel has many hardcoded dark colors that should use variables:

```css
Line 1064: background-color: #1e1e1e;
Line 1085: background-color: #333;
Line 1119: background: #333;
Line 1133: background: #444;
Line 1243: background-color: #252525;
Line 1258: background-color: #333;
Line 1305: background-color: #1a1a1a;
Line 1321: background-color: #2a2a2a;
Line 1326: background-color: #2d3b4a;
Line 1362: background-color: #2a2a2a;
```

## Status Indicators (10+ instances)

### Google Auth Status
```css
.google-status {
  background-color: #999; /* Should be var(--text-secondary) */
}

.google-btn.connected .google-status {
  background-color: #4285f4; /* Might need --status-connected variable */
}
```

### Recording Status
```css
Line 928: background-color: #ff3b30; /* Recording active - needs --status-recording */
Line 963: background-color: #d93129; /* Recording hover */
```

## Color Values That Appear Multiple Times

### `#f5f5f5` (appears 10+ times)
- Should be: `var(--card-hover)` or `var(--bg-secondary)`
- Found in: buttons, meeting cards, calendar, panels

### `white` (appears 20+ times)
- Should be: `var(--card-bg)`
- Found in: modals, template items, checkboxes, panels

### `#333`, `#444`, `#1e1e1e`, `#252525` (debug panel)
- Should be: `var(--card-bg)`, `var(--bg-secondary)`, or `var(--border-color)`
- Found in: debug panel components

### `#4285f4` (Google blue - appears 5+ times)
- Might need: `--brand-google: #4285f4;` variable
- Found in: Google auth button, status indicators

## Recommended Approach

### Phase 1: Critical User-Facing Elements
1. Search bar background
2. Add scrollbar styling
3. Refresh/settings/debug/export button backgrounds
4. Meeting card backgrounds

### Phase 2: Interactive Elements
1. Modal backgrounds
2. Template item backgrounds
3. Checkbox/form element backgrounds

### Phase 3: Calendar System
1. Event type colors
2. Time slot colors
3. Recording status colors
4. Hover states

### Phase 4: Debug Panel
1. Panel backgrounds
2. Section backgrounds
3. Log viewer styles

### Phase 5: Additional Variables
May need to add new CSS variables:
```css
:root {
  --status-recording: #ff3b30;
  --status-connected: #4285f4;
  --status-success: #4caf50;
  --event-meeting: #6947bd;
  --event-break: #059669;
  --brand-google: #4285f4;
}

body.dark-theme {
  --status-recording: #ff6961;
  --status-connected: #5a9fd4;
  --status-success: #6fbf73;
  --event-meeting: #8b5cf6;
  --event-break: #10b981;
  /* Google blue stays same for brand consistency */
}
```

## Search Commands to Find Issues

```bash
# Find all hardcoded background colors
grep -n "background.*#[0-9a-fA-F]" src/index.css | grep -v "var(--"

# Find all hardcoded text colors
grep -n "color:\s*#[0-9]" src/index.css | grep -v "var(--"

# Find white/black keywords
grep -n ":\s*white\|:\s*black" src/index.css | grep -v "var(--"

# Count total issues
grep -n "background\|color:" src/index.css | grep -E "#[0-9a-fA-F]{3,6}|:\s*white|:\s*black" | grep -v "var(--" | grep -v "^[0-9]*:\s*--" | wc -l
```

## Testing Checklist

After fixes, test in both light and dark modes:
- [ ] Search bar is readable
- [ ] Scrollbars are styled and visible
- [ ] All buttons are visible (settings, debug, export, refresh, etc.)
- [ ] Meeting cards are distinct from background
- [ ] Meeting cards hover state works
- [ ] Modals are readable
- [ ] Template selection UI works
- [ ] Calendar events are visible and color-coded
- [ ] Debug panel is readable
- [ ] All text has sufficient contrast

## Related Files

- `src/index.css` - Main stylesheet with 172 issues
- `src/renderer/settings.js` - Settings panel that switches themes
- `src/index.html` - HTML structure (no color issues found here)

## Notes

- Import modal was already fixed (completed earlier in session)
- Phase 10.7 app settings panels already use CSS variables
- Main application structure uses CSS variables correctly
- This is legacy CSS from earlier phases that predated comprehensive dark mode support
