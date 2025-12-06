# Test Transcripts for Phase 10.8.1

This folder contains sample transcripts for testing the pattern configuration system.

## Quick Start

**Run automated tests:**

```bash
node quick-test-patterns.js
```

**Run comprehensive test suite:**

```bash
node test-pattern-loader.js
```

## Test Files

### `basic-inline.txt`

- **Pattern:** Inline speaker (Name: text)
- **Tests:** Basic backward compatibility
- **Speakers:** John Smith, Mary Johnson

### `header-format.txt`

- **Pattern:** Speaker on own line (Name:\n"text")
- **Tests:** Header pattern, quote stripping
- **Speakers:** John Smith, Mary Johnson

### `special-characters.txt` ⭐ NEW

- **Pattern:** Extended character support
- **Tests:** Numbers, apostrophes, periods, hyphens in names
- **Speakers:** Dr. Smith, O'Brien, Speaker 1, Mary-Anne Johnson, Prof. Williams Jr.
- **Note:** Would NOT have worked before Phase 10.8.1

### `with-timestamps.txt`

- **Pattern:** Timestamp variants
- **Tests:** Bracketed, plain, dash-separated timestamps
- **Formats:** `[HH:MM:SS]`, `HH:MM:SS`, `HH:MM:SS -`

### `mixed-format.txt`

- **Pattern:** Multiple patterns in one file
- **Tests:** Priority ordering, pattern coexistence
- **Combines:** Headers, inline, timestamps

## Testing in the App

1. **Start the app:**

   ```bash
   npm start
   ```

2. **Import a test file:**
   - Click "Import" button
   - Select a file from this folder
   - Click "Import Files"

3. **Check results:**
   - View meeting in list
   - Open meeting details
   - Check Transcript tab
   - Verify speakers are correct

## Expected Results

### Before Phase 10.8.1:

- ❌ "Dr. Smith" → Parsed as "Unknown"
- ❌ "Speaker 1" → Parsing might fail
- ❌ "O'Brien" → Apostrophe might break parsing
- ❌ "Mary-Anne" → Hyphen might break parsing

### After Phase 10.8.1:

- ✅ "Dr. Smith" → Correctly identified
- ✅ "Speaker 1" → Correctly identified
- ✅ "O'Brien" → Correctly identified
- ✅ "Mary-Anne Johnson" → Correctly identified

## Customizing Patterns

Edit `config/transcript-patterns.yaml` to add your own patterns:

```yaml
- id: 'your-pattern-id'
  name: 'Your Pattern Name'
  description: 'Description of what it matches'
  type: 'inline' # or "header" or "timestamp"
  regex: "^([A-Za-z]+):\\s+(.+)"
  captureGroups:
    speaker: 1
    text: 2
  enabled: true
  priority: 10
```

Restart the app to load new patterns.

## Full Testing Guide

See `TESTING-PHASE-10.8.1.md` for comprehensive testing instructions.
