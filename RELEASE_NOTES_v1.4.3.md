# v1.4.3 Release Notes

## Highlights
Upgrades the Recall.ai Desktop SDK from 2.0.6 to 2.0.8, bringing audio quality improvements and better device handling on Windows.

---

## Recall.ai Desktop SDK 2.0.6 → 2.0.8

- **Reduced audio glitches**: Fewer blips in the audio mixing process, improving transcription accuracy.
- **Fixed Windows audio latency**: Lower latency during capture.
- **Robust device switching**: Better handling when audio devices change mid-recording (e.g., plugging in a headset).
- **Network status event**: Automatic recording stopping on network loss.
- **Consistent recording IDs on SDK events**: Complements the v1.4.2 race condition fix by ensuring events carry correct window IDs.
- **Faster stop-recording**: Fixed cases where stopping a recording would hang and block future commands.

---

## Dependencies

| Package | Old | New |
|---------|-----|-----|
| `@recallai/desktop-sdk` | 2.0.6 | 2.0.8 |

---

## Files Changed
3 files changed (package.json, package-lock.json, src/index.html)
