# Testing Guide: Phase 10.8.1 - Pattern Configuration System

This guide provides comprehensive testing steps for the new configurable transcript pattern system.

---

## 🚀 Quick Test (5 minutes)

### Test 1: Import with Basic Patterns

**Goal:** Verify backward compatibility with original parsing behavior.

1. **Start the application:**
   ```bash
   npm start
   ```

2. **Navigate to Import:**
   - Click the "Import" button in the main UI
   - Select "Choose Files"

3. **Import the basic inline transcript:**
   - File: `test-transcripts/basic-inline.txt`
   - Check options:
     - ☐ Generate auto-summary (optional)
     - ☐ Select templates (optional)
     - ☑ Auto-export to Obsidian
   - Click "Import Files"

4. **Verify results:**
   - ✅ Meeting should appear in meetings list
   - ✅ Open the meeting details
   - ✅ Check transcript tab - should show:
     - John Smith: 2 entries
     - Mary Johnson: 2 entries
   - ✅ All speaker names correctly identified
   - ✅ No "Unknown" speakers

**Expected Outcome:** Import succeeds, speakers correctly identified.

---

### Test 2: Special Characters (NEW in 10.8.1)

**Goal:** Test extended pattern support for special characters.

1. **Import the special characters transcript:**
   - File: `test-transcripts/special-characters.txt`
   - Click "Import Files"

2. **Verify results:**
   - ✅ Dr. Smith - recognized (period in name)
   - ✅ O'Brien - recognized (apostrophe in name)
   - ✅ Speaker 1 - recognized (number in name)
   - ✅ Mary-Anne Johnson - recognized (hyphen in name)
   - ✅ Prof. Williams Jr. - recognized (period and abbreviation)

**Expected Outcome:** All speakers with special characters correctly identified.

**What would have happened BEFORE 10.8.1:**
- ❌ "Dr. Smith" would be parsed as "Unknown"
- ❌ "Speaker 1" would be parsed as "Unknown"
- ❌ "O'Brien" might fail to match

---

### Test 3: Header Format

**Goal:** Test speaker-on-own-line pattern.

1. **Import the header format transcript:**
   - File: `test-transcripts/header-format.txt`

2. **Verify results:**
   - ✅ John Smith: 2 entries
   - ✅ Mary Johnson: 2 entries
   - ✅ Quotes stripped from text
   - ✅ Each speaker's text properly collected across multiple lines

**Expected Outcome:** Header pattern matches correctly, text grouped by speaker.

---

### Test 4: Timestamps

**Goal:** Test timestamp pattern variants.

1. **Import the timestamp transcript:**
   - File: `test-transcripts/with-timestamps.txt`

2. **Verify results:**
   - ✅ Entries have timestamps
   - ✅ Different timestamp formats recognized:
     - `[00:00:15]` - bracketed
     - `00:02:45` - plain
     - `00:05:20 -` - with dash

**Expected Outcome:** All timestamp formats parsed correctly.

---

### Test 5: Mixed Formats

**Goal:** Test priority ordering with multiple pattern types.

1. **Import the mixed format transcript:**
   - File: `test-transcripts/mixed-format.txt`

2. **Verify results:**
   - ✅ Header patterns (Dr. Smith:, Mary-Anne:) parsed correctly
   - ✅ Inline patterns (O'Brien:, Speaker 1:) parsed correctly
   - ✅ Timestamps parsed correctly
   - ✅ Pattern priority ordering working (header > inline > timestamp)

**Expected Outcome:** All patterns coexist correctly in single transcript.

---

## ⚙️ Advanced Test (15 minutes)

### Test 6: Edit Pattern Configuration

**Goal:** Test user-editable patterns via YAML.

1. **Open the pattern configuration file:**
   ```bash
   code config/transcript-patterns.yaml
   ```

2. **Add a custom pattern:**
   ```yaml
   - id: "custom-moderator"
     name: "Moderator Pattern"
     description: "[Moderator] Name: text"
     type: "inline"
     regex: "^\\[Moderator\\]\\s*([A-Za-z0-9\\s.'-]+):\\s+(.+)"
     captureGroups:
       speaker: 1
       text: 2
     enabled: true
     priority: 10
   ```

3. **Create a test file:**
   - Create `test-transcripts/moderator-test.txt`:
     ```
     [Moderator] John: Welcome everyone.
     Mary: Thanks for having us.
     [Moderator] John: Let's begin.
     ```

4. **Restart the app** (to reload config):
   ```bash
   npm start
   ```

5. **Import the moderator test file:**
   - Verify "[Moderator] John" is parsed as speaker "John"

**Expected Outcome:** Custom pattern works without code changes.

---

### Test 7: Disable a Pattern

**Goal:** Test enable/disable toggle.

1. **Edit `config/transcript-patterns.yaml`:**
   - Find `inline-basic` pattern
   - Change `enabled: true` to `enabled: false`
   - Save file

2. **Restart the app**

3. **Import `test-transcripts/basic-inline.txt` again:**
   - This time, only the `inline-extended` pattern should match
   - Results should still be correct (extended pattern covers basic cases)

4. **Re-enable the pattern:**
   - Change back to `enabled: true`
   - Restart app
   - Import should work as before

**Expected Outcome:** Disabling patterns prevents them from matching.

---

### Test 8: Pattern Priority

**Goal:** Test priority ordering.

1. **Edit `config/transcript-patterns.yaml`:**
   - Note current priorities:
     - `header-basic`: priority 1
     - `header-extended`: priority 2
     - `inline-basic`: priority 3
     - `inline-extended`: priority 4

2. **Swap priorities:**
   - Change `header-basic` to priority 10
   - Change `inline-basic` to priority 1
   - Save file

3. **Restart app and import `test-transcripts/mixed-format.txt`**

4. **Verify results:**
   - Inline patterns now have higher priority
   - Lines like "Dr. Smith:" might be parsed differently

5. **Restore original priorities**

**Expected Outcome:** Priority order affects which pattern matches first.

---

## 🧪 Edge Case Testing (30 minutes)

### Test 9: Invalid Pattern Configuration

**Goal:** Test validation and error handling.

1. **Create invalid YAML:**
   - Edit `config/transcript-patterns.yaml`
   - Add invalid regex:
     ```yaml
     - id: "broken"
       name: "Broken Pattern"
       type: "inline"
       regex: "[invalid regex((("
       captureGroups:
         speaker: 1
       enabled: true
       priority: 100
     ```

2. **Restart app and check console:**
   - Should see error: "Invalid pattern configuration"
   - Should fall back to default patterns
   - App should NOT crash

3. **Fix the YAML:**
   - Remove or fix the broken pattern
   - Restart app
   - Should load successfully

**Expected Outcome:** Validation catches errors, provides fallback.

---

### Test 10: Missing Configuration File

**Goal:** Test fallback when config missing.

1. **Temporarily rename the config:**
   ```bash
   mv config/transcript-patterns.yaml config/transcript-patterns.yaml.backup
   ```

2. **Restart app**

3. **Check console output:**
   - Should see: "Configuration file not found"
   - Should see: "Using fallback default patterns"

4. **Import a basic transcript:**
   - Should still work with built-in patterns
   - Basic inline and header patterns should function

5. **Restore config:**
   ```bash
   mv config/transcript-patterns.yaml.backup config/transcript-patterns.yaml
   ```

**Expected Outcome:** Missing config doesn't break app, uses defaults.

---

### Test 11: Pattern with No Matches

**Goal:** Test fallback to "Unknown" speaker.

1. **Create a transcript with unusual format:**
   - Create `test-transcripts/unusual.txt`:
     ```
     This is just plain text.
     No speaker markers at all.
     Just random content.
     ```

2. **Import the file**

3. **Verify results:**
   - All lines should be attributed to "Unknown" speaker
   - No crashes or errors
   - Text should be preserved

**Expected Outcome:** Graceful handling of non-matching content.

---

## 📊 Automated Test Suite

### Test 12: Run Automated Tests

**Goal:** Verify all unit tests pass.

1. **Run the test script:**
   ```bash
   node test-pattern-loader.js
   ```

2. **Verify output:**
   - ✅ All 7 test sections pass
   - ✅ Pattern validation works
   - ✅ 9 patterns loaded from config
   - ✅ 7 patterns enabled
   - ✅ 10 entries parsed from sample
   - ✅ All unique speakers detected

**Expected Outcome:** All automated tests pass.

---

## 🎯 Real-World Test

### Test 13: Import Your Own Transcript

**Goal:** Test with real-world data.

1. **Find a real transcript file you have:**
   - Zoom transcript
   - Teams meeting notes
   - Otter.ai export
   - Any .txt transcript

2. **Import it through the UI**

3. **Check the results:**
   - How many speakers detected?
   - How many "Unknown" entries?
   - Are speaker names correct?

4. **If parsing fails:**
   - Look at the transcript format
   - Identify the pattern
   - Add a custom pattern to `transcript-patterns.yaml`
   - Restart and try again

**Expected Outcome:** Real transcripts parse reasonably well, or you can add patterns to improve.

---

## ✅ Success Checklist

After running tests, verify:

- [ ] Basic inline format works (backward compatible)
- [ ] Header format works (backward compatible)
- [ ] Special characters work (NEW - Dr., O'Brien, Speaker 1)
- [ ] Timestamp patterns work
- [ ] Mixed formats work together
- [ ] Custom patterns can be added via YAML
- [ ] Patterns can be enabled/disabled
- [ ] Priority ordering affects matching
- [ ] Invalid config triggers fallback
- [ ] Missing config uses defaults
- [ ] Automated tests pass
- [ ] Real transcript imports successfully

---

## 🐛 What to Look For

### Signs of Success:
- ✅ Speakers correctly identified
- ✅ No "Unknown" speakers (unless expected)
- ✅ Text properly attributed
- ✅ Timestamps parsed correctly
- ✅ Quotes stripped appropriately

### Signs of Issues:
- ❌ All speakers showing as "Unknown"
- ❌ Text split incorrectly
- ❌ App crashes on import
- ❌ Config file not loading
- ❌ Pattern changes not taking effect

### Common Issues:

**Issue:** Pattern changes don't take effect
**Solution:** Restart the app (config loads on startup)

**Issue:** Speaker names include extra characters
**Solution:** Adjust regex in pattern to trim correctly

**Issue:** Some speakers not detected
**Solution:** Check if pattern priority is correct, or add new pattern

---

## 📝 Reporting Results

If you find issues, note:
1. Which transcript file caused the problem
2. What you expected to happen
3. What actually happened
4. Error messages (if any)
5. Console output

---

## 🎓 Understanding the Output

When you import a transcript, the parser:

1. **Loads patterns** from `config/transcript-patterns.yaml`
2. **Sorts by priority** (1 = highest)
3. **Tries each pattern** in order on each line
4. **Stops at first match** per line
5. **Attributes text** to speaker
6. **Creates transcript entries** for the meeting

The patterns define HOW to recognize speakers in different formats.

---

**Phase 10.8.1 Complete** ✅

This pattern system is the foundation for Phase 10.8.2 (UI Preview) and Phase 10.8.3 (AI Pattern Builder).
