# RD-3: Obsidian File Watching & Link Management

## Summary

This document captures research findings for detecting when users move meeting notes within Obsidian, so the app can update its stored links.

**Problem:** When users manually move or rename notes within Obsidian, the app's stored file paths become stale, breaking the "Open in Obsidian" functionality.

---

## Research Findings

### 1. Obsidian Plugin API Events

If we built a companion Obsidian plugin, it could listen to vault events:

```typescript
// Register rename event listener
this.registerEvent(
  this.app.vault.on('rename', (file, oldPath) => {
    console.log(`File renamed: ${oldPath} -> ${file.path}`);
    // Notify main app of path change
  })
);

// Other available events
this.app.vault.on('create', (file) => { /* file created */ });
this.app.vault.on('delete', (file) => { /* file deleted */ });
this.app.vault.on('modify', (file) => { /* file modified */ });
```

**Caveats:**
- Only works when Obsidian is running
- External renames (file explorer, other apps) appear as delete+create, not rename
- Requires users to install a companion plugin

**References:**
- [Obsidian Forum: File Rename Event API](https://forum.obsidian.md/t/api-callback-for-file-rename-event/11395)

### 2. File System Watchers (Chokidar)

Chokidar is the standard Node.js library for file watching:

```javascript
const chokidar = require('chokidar');

const watcher = chokidar.watch('/path/to/vault', {
  persistent: true,
  ignoreInitial: true,
  depth: 10
});

watcher
  .on('add', path => console.log(`File added: ${path}`))
  .on('unlink', path => console.log(`File removed: ${path}`))
  .on('change', path => console.log(`File changed: ${path}`));
```

**Key Limitation:** No native rename event. Renames appear as `unlink` + `add`, making it hard to correlate the old and new paths.

**Potential Workaround:** Track file by inode (on Unix) or unique content hash, but this is complex and unreliable.

**References:**
- [GitHub: paulmillr/chokidar](https://github.com/paulmillr/chokidar)

### 3. External Rename Handler Plugin

There's an existing Obsidian plugin that handles external renames:
- Detects when external tools rename files
- Treats delete+create as a single rename event
- Requires Obsidian to be running during the rename

**Reference:**
- [GitHub: obsidian-external-rename-handler](https://github.com/mnaoumov/obsidian-external-rename-handler)

### 4. Frontmatter Meeting ID Approach (Recommended)

Our notes already include a unique meeting ID in the YAML frontmatter:

```yaml
---
meeting_id: "abc123-def456"
title: "Q4 Planning Meeting"
date: 2024-12-01
---
```

This provides a reliable anchor for finding moved files:

1. Store `meeting_id` in each note's frontmatter (already done)
2. Store the file path in the app's database
3. When opening a note, check if path is valid
4. If stale, scan vault for files matching the meeting ID
5. Update stored path to current location

---

## Approach Comparison

| Approach | Pros | Cons |
|----------|------|------|
| **Obsidian Plugin** | Real-time events, accurate | Requires companion plugin, only works when Obsidian running |
| **Chokidar Watcher** | No plugin needed | No rename event, resource-intensive, complex correlation |
| **Manual Refresh Scan** | Simple, reliable, works offline | User must trigger, slight delay |
| **Frontmatter ID Lookup** | Works regardless of how file moved | Requires vault scan, but fast with frontmatter parsing |

---

## Recommended Solution: Manual Refresh with Frontmatter IDs

### Why Manual Refresh?

1. **No continuous resource usage** - File watching is resource-intensive
2. **Works regardless of method** - Catches moves via Obsidian, file explorer, sync services
3. **No plugin dependency** - Users don't need to install anything extra
4. **Reliable** - Frontmatter IDs are part of the file content, survive moves

### Implementation Design

#### 1. Store Meeting ID in Frontmatter (Already Done)

```markdown
---
meeting_id: "meeting-1733234567890"
title: "Client Strategy Session"
date: 2024-12-03
---
```

#### 2. Validate Link on Access

```javascript
async function openInObsidian(meetingId, storedPath) {
  // Check if stored path is still valid
  if (await pathExists(storedPath)) {
    openFile(storedPath);
    return;
  }

  // Path is stale - try to find the file by meeting ID
  const newPath = await findFileByMeetingId(meetingId);

  if (newPath) {
    // Update stored path and open
    await updateStoredPath(meetingId, newPath);
    openFile(newPath);
  } else {
    // File not found - notify user
    showNotification('Note not found. It may have been deleted.');
  }
}
```

#### 3. Vault Scan Function

```javascript
/**
 * Scan vault for a note with matching meeting_id in frontmatter
 * @param {string} meetingId - The meeting ID to search for
 * @returns {string|null} Path to file, or null if not found
 */
async function findFileByMeetingId(meetingId) {
  const vaultPath = getVaultPath();
  const markdownFiles = await glob('**/*.md', { cwd: vaultPath });

  for (const file of markdownFiles) {
    const content = await readFile(path.join(vaultPath, file));
    const frontmatter = parseFrontmatter(content);

    if (frontmatter?.meeting_id === meetingId) {
      return file;
    }
  }

  return null;
}
```

#### 4. Bulk Refresh Function

```javascript
/**
 * Refresh all stored links by scanning vault
 * Call from Settings > "Refresh Obsidian Links"
 */
async function refreshAllLinks() {
  const meetings = await getAllMeetingsWithObsidianPaths();
  const results = { updated: 0, notFound: 0, unchanged: 0 };

  for (const meeting of meetings) {
    if (await pathExists(meeting.obsidianPath)) {
      results.unchanged++;
      continue;
    }

    const newPath = await findFileByMeetingId(meeting.id);

    if (newPath) {
      await updateStoredPath(meeting.id, newPath);
      results.updated++;
    } else {
      results.notFound++;
    }
  }

  return results;
}
```

---

## UI Design

### Refresh Links Button

Location: Settings > Obsidian Integration section

```
[Refresh Obsidian Links]

Last refreshed: Never
Notes tracked: 45
```

### Results Modal

```
Link Refresh Complete

✓ Updated: 3 notes found at new locations
⚠ Not Found: 1 note could not be located
- Unchanged: 41 notes at expected locations

[View Not Found] [Close]
```

### Not Found Resolution

For notes that can't be found automatically:
1. Show meeting title and expected path
2. Offer "Locate Manually" button (file picker)
3. Option to mark as "Deleted" (removes from tracking)

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/main/storage/VaultStructure.js` | Add `findFileByMeetingId()`, `refreshAllLinks()` |
| `src/renderer/settings.js` | Add "Refresh Obsidian Links" UI |
| Meeting data model | Ensure `meeting_id` is in frontmatter |
| `src/main.js` | Add IPC handlers for link refresh |

---

## Future Considerations

### Optional: Background Link Validation

Could periodically validate links (e.g., on app startup) and show a badge if stale links detected:

```
⚠ 3 Obsidian links may be stale. [Refresh]
```

### Optional: Obsidian Companion Plugin

If user demand exists, could build a simple companion plugin:
- Listens for rename/move events
- Sends path updates to main app via local HTTP or file-based IPC
- Provides "JD Notes Things" command palette integration

---

## Testing Checklist

- [ ] Verify meeting_id is included in all exported note frontmatter
- [ ] Test findFileByMeetingId with valid meeting ID
- [ ] Test with non-existent meeting ID
- [ ] Test refresh with moved file
- [ ] Test refresh with deleted file
- [ ] Test manual file location via picker
- [ ] Performance test with 100+ notes in vault

---

## References

- [Obsidian Plugin API](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)
- [GitHub: paulmillr/chokidar](https://github.com/paulmillr/chokidar)
- [Obsidian Forum: File Rename Event](https://forum.obsidian.md/t/api-callback-for-file-rename-event/11395)
- [GitHub: obsidian-external-rename-handler](https://github.com/mnaoumov/obsidian-external-rename-handler)
