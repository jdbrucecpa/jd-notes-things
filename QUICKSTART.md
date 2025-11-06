# Quick Start Guide - Phase 1 Implementation

**Pick up where we left off on your Windows machine**

---

## What's Already Done ✅

1. ✅ Project initialized with Electron + TypeScript + React
2. ✅ All dependencies installed
3. ✅ Basic UI built (recording widget with start/stop buttons)
4. ✅ Project structure created
5. ✅ TypeScript types and constants defined
6. ✅ Build system verified working

---

## What You Need to Do

### Step 1: Get API Keys (15 minutes)

#### Recall.ai
1. Go to https://recall.ai
2. Sign up for an account
3. Navigate to API settings
4. Copy your API key
5. Note your region (probably `us-east-1`)

#### AssemblyAI
1. Go to https://assemblyai.com
2. Sign up for an account
3. Navigate to API settings/dashboard
4. Copy your API key

### Step 2: Configure Environment (2 minutes)

```bash
# In project root
cp .env.example .env
```

Edit `.env` and add your API keys:
```env
RECALLAI_API_URL=https://us-east-1.recall.ai
RECALLAI_API_KEY=paste_your_key_here
ASSEMBLYAI_API_KEY=paste_your_key_here
VAULT_PATH=./vault
```

### Step 3: Test the Build (2 minutes)

```bash
npm start
```

You should see:
- Webpack compilation success
- Electron window opens
- "JD Notes Things" header
- Recording widget with "Start Recording" button

If it works, you're ready to implement! If not, check:
- Node.js version (need v18+)
- Windows OS (Recall.ai SDK requirement)
- No firewall blocking Electron

---

## Implementation Order

### Task 1: Main Electron Process (30-45 minutes)

**File:** `src/main/index.ts`

**What to do:**
1. Import required modules (BrowserWindow, app, ipcMain)
2. Create main window with proper settings
3. Load the renderer HTML
4. Set up IPC handlers for:
   - `recording:start`
   - `recording:stop`
   - `recording:pause` (optional for Phase 1)

**Reference:**
- Check `src/main/index.ts` - it's currently the boilerplate Electron main
- See muesli-public example: https://github.com/recallai/muesli-public

**Expected Result:** Electron window opens and IPC handlers are ready

---

### Task 2: Preload Script (15 minutes)

**File:** `src/preload.ts`

**What to do:**
1. Use `contextBridge` to expose IPC API
2. Create methods for:
   - `startRecording()`
   - `stopRecording()`
   - `onRecordingStarted(callback)`
   - `onRecordingError(callback)`

**Reference:**
- Current `src/preload.ts` is minimal
- Electron contextBridge docs: https://www.electronjs.org/docs/latest/api/context-bridge

**Expected Result:** Renderer can call `window.api.startRecording()` safely

---

### Task 3: Recording Manager (45-60 minutes)

**File:** `src/main/recording/RecordingManager.ts`

**What to do:**
1. Import `@recallai/desktop-sdk`
2. Initialize SDK with API key from env
3. Implement `startRecording()` method
4. Implement `stopRecording()` method
5. Save audio file to temp location
6. Return file path when done

**Reference:**
- Recall.ai docs: https://docs.recall.ai
- muesli-public implementation for examples
- See `src/shared/types.ts` for `RecordingSession` interface

**Expected Result:** Can record system audio and save to file

---

### Task 4: Transcription Service (30-45 minutes)

**File:** `src/main/transcription/TranscriptionService.ts`

**What to do:**
1. Import `assemblyai` package
2. Initialize client with API key
3. Implement `transcribe(audioFilePath)` method
4. Upload audio file
5. Poll for completion
6. Parse speaker diarization results
7. Return formatted transcript

**Reference:**
- AssemblyAI docs: https://www.assemblyai.com/docs
- Use `assemblyai` npm package
- See `src/shared/types.ts` for `Transcript` and `TranscriptSegment` interfaces

**Expected Result:** Audio file → transcript with speaker labels

---

### Task 5: File Manager (20-30 minutes)

**File:** `src/main/storage/FileManager.ts`

**What to do:**
1. Import Node.js `fs` module
2. Implement `saveTranscript(transcript, metadata)` method
3. Generate filename: `YYYY-MM-DD-HH-MM-transcript.md`
4. Format transcript as Markdown:
   ```markdown
   # Meeting Transcript

   **Date:** 2025-11-05
   **Duration:** 15 minutes

   ## Transcript

   **14:30:05 - Speaker 1**
   Let's start the meeting...

   **14:30:15 - Speaker 2**
   Sounds good...
   ```
5. Save to current directory (routing comes in Phase 2)

**Reference:**
- See `docs/index-example.md` for Markdown format examples
- Use `src/shared/constants.ts` for filename format

**Expected Result:** Transcript saved to `./2025-11-05-14-30-transcript.md`

---

### Task 6: Wire Up the UI (15 minutes)

**File:** `src/renderer/App.tsx`

**What to do:**
1. Replace `console.log` with actual `window.api` calls
2. Add error handling
3. Add loading states
4. Listen for IPC events (recording started, error, etc.)

**Current code:**
```typescript
const handleStartRecording = () => {
  console.log('Start recording');  // ← Replace this
  setIsRecording(true);
};
```

**New code:**
```typescript
const handleStartRecording = async () => {
  try {
    await window.api.startRecording();
    setIsRecording(true);
  } catch (error) {
    console.error('Failed to start recording:', error);
    // Show error to user
  }
};
```

**Expected Result:** Clicking buttons triggers actual recording

---

### Task 7: Test End-to-End (30 minutes)

**What to test:**
1. Start app with `npm start`
2. Click "Start Recording"
3. Say something or play audio
4. Wait 30 seconds
5. Click "Stop Recording"
6. Wait for transcription (may take 1-2 minutes)
7. Check current directory for `YYYY-MM-DD-HH-MM-transcript.md`
8. Open file and verify:
   - Transcript text is present
   - Speaker labels are included
   - Timestamps are correct
   - Markdown formatting is clean

**Debug checklist:**
- [ ] API keys are correct in `.env`
- [ ] Audio file was created (check temp directory)
- [ ] Transcription API call succeeded (check console logs)
- [ ] File was saved (check current directory)
- [ ] Markdown is formatted correctly

---

## Total Estimated Time

- **Getting API keys:** 15 minutes
- **Configuration:** 2 minutes
- **Testing build:** 2 minutes
- **Implementation:** 3-4 hours
- **Testing:** 30 minutes

**Total:** 4-5 hours

---

## Success Criteria

Phase 1 is complete when:
- ✅ Can click "Start Recording" and see status change
- ✅ System audio is captured
- ✅ Clicking "Stop Recording" triggers transcription
- ✅ Transcript is saved with proper filename format
- ✅ Transcript includes speaker labels (Speaker 1, Speaker 2, etc.)
- ✅ Transcript has timestamps
- ✅ Markdown formatting is clean and readable

---

## Troubleshooting

### Electron won't start
- Make sure you're on Windows (Recall.ai requirement)
- Try running `npm install` again
- Delete `node_modules` and reinstall

### Recall.ai SDK errors
- Verify API key is correct
- Check API URL matches your region
- Try hitting Recall.ai API directly with curl to verify credentials

### AssemblyAI fails
- Verify API key is correct
- Check audio file format (should be WAV or MP3)
- Try uploading a test file manually to AssemblyAI dashboard

### No transcript saved
- Check file permissions
- Verify current directory is writable
- Add console.log statements to track progress
- Check for errors in DevTools console

---

## After Phase 1 is Complete

See `SPECIFICATION.md` for Phase 2:
- Routing system with YAML configuration
- Automatic file organization by client
- Email domain matching

But first, make sure Phase 1 works perfectly!

---

## Questions?

Check these files:
- `PROGRESS.md` - Detailed progress and what's next
- `SPECIFICATION.md` - Full product spec
- `CLAUDE.md` - Architecture overview
- `src/shared/types.ts` - TypeScript interfaces you'll need

Good luck! 🚀
