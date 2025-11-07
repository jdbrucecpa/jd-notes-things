# JD Notes Things - Technical Debt & Remediation Plan

**Last Updated:** November 6, 2025
**Status:** Phase 1 Complete - Managing Technical Debt During Development

---

## Philosophy

This document tracks known technical debt and provides a practical remediation plan. Since we're building iteratively through phases, the goal is to **avoid accumulating compounding debt** rather than achieving production perfection before Phase 2.

**Guiding Principles**:
- Fix issues that block future development
- Defer issues that don't impact current functionality
- Address security concerns immediately
- Improve code quality incrementally

---

## Critical Issues - Fix Before Phase 2

These issues will cause problems or block development if not addressed:

### 1. API Key Security ⚠️ URGENT

**Issue**: API keys exposed in `.env` file and logged to console

**Impact**: Security breach, potential unauthorized usage

**Files Affected**:
- `src/main.js:22` - OpenRouter key passed to client
- `src/main.js:371` - Upload token logged
- `src/server.js:12` - API key logged (deprecated file)

**Remediation** (Estimated: 2 hours):
```bash
# 1. Revoke current keys (do this first!)
#    - Recall.ai dashboard: Generate new API key
#    - Deepgram dashboard: Generate new API key (if using)
#    - OpenRouter: Generate new API key

# 2. Add .env to .gitignore if not already
echo ".env" >> .gitignore

# 3. Create .env.example template (no real keys)
cp .env .env.example
# Edit .env.example to replace keys with placeholders

# 4. Remove console.log statements that output keys
# Search for: console.log.*API.*KEY
# Search for: console.log.*token
```

**Code Changes**:
```javascript
// src/main.js - Remove key logging
// BEFORE:
console.log("Upload token created successfully:", response.data.upload_token);

// AFTER:
console.log("Upload token created successfully:", response.data.upload_token?.substring(0, 8) + '...');
```

**Priority**: 🔴 **DO IMMEDIATELY** before committing any code

---

### 2. Electron Security Vulnerability

**Issue**: Electron 36.0.1 has CVE (ASAR integrity bypass)

**Impact**: Moderate security risk (CVSS 6.1)

**Remediation** (Estimated: 30 minutes):
```bash
# Update Electron to latest stable
npm install electron@latest --save-dev

# Also update Electron Forge
npm install @electron-forge/cli@latest --save-dev

# Run audit and fix
npm audit fix

# Test that app still runs
npm start
```

**Priority**: 🔴 **Complete before Phase 2 starts**

---

### 3. Remove Unused Dependencies

**Issue**: Bloated package.json with unused packages

**Impact**: Larger bundle size, slower installs, unnecessary attack surface

**Files to Remove**:
- `simplemde` (line 58) - Duplicate of easymde, not used
- `easymde` (line 51) - Not referenced anywhere
- `codemirror` (line 49) - Not referenced anywhere
- `react-markdown` (line 57) - Not referenced anywhere
- `@babel/plugin-proposal-class-properties` (line 22) - Deprecated

**Remediation** (Estimated: 15 minutes):
```bash
npm uninstall simplemde easymde codemirror react-markdown @babel/plugin-proposal-class-properties
```

**Verify**: App still builds and runs after removal

**Priority**: 🟡 **Complete during Phase 2 setup**

---

### 4. Input Validation for IPC Handlers

**Issue**: No validation on IPC parameters, potential code injection

**Impact**: Security vulnerability, data corruption risk

**Affected Handlers**:
- `saveMeetingsData` - No data validation
- `deleteMeeting` - No meetingId validation
- `startManualRecording` - No meetingId validation
- `stopManualRecording` - No recordingId validation

**Remediation** (Estimated: 3-4 hours):

**Install validation library**:
```bash
npm install zod --save
```

**Create validation schemas** (`src/shared/validation.js`):
```javascript
const { z } = require('zod');

const MeetingSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['profile', 'calendar', 'document']),
  title: z.string(),
  date: z.string().datetime(),
  participants: z.array(z.object({
    name: z.string(),
    id: z.string().optional(),
  })).optional(),
  transcript: z.array(z.any()).optional(),
  content: z.string().optional(),
});

const MeetingsDataSchema = z.object({
  upcomingMeetings: z.array(MeetingSchema),
  pastMeetings: z.array(MeetingSchema),
});

module.exports = { MeetingSchema, MeetingsDataSchema };
```

**Update IPC handlers** (example):
```javascript
const { MeetingsDataSchema } = require('./shared/validation');

ipcMain.handle('saveMeetingsData', async (event, data) => {
  try {
    // Validate input
    const validatedData = MeetingsDataSchema.parse(data);

    await fileOperationManager.writeData(validatedData);
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: 'Invalid data format: ' + error.message };
    }
    return { success: false, error: error.message };
  }
});
```

**Priority**: 🟡 **Add incrementally during Phase 2 development**

---

## High-Priority Issues - Address During Phase 2

These issues should be addressed as we build Phase 2 features:

### 5. Implement Proper Logging Framework

**Issue**: 250+ console.log statements, no log levels, not production-ready

**Impact**: Performance, debugging difficulty, information leakage

**Remediation** (Estimated: 2-3 hours):

**Install electron-log**:
```bash
npm install electron-log --save
```

**Create logger utility** (`src/shared/logger.js`):
```javascript
const log = require('electron-log');

// Configure log levels
if (process.env.NODE_ENV === 'production') {
  log.transports.console.level = 'warn';
  log.transports.file.level = 'info';
} else {
  log.transports.console.level = 'debug';
  log.transports.file.level = 'debug';
}

// Add custom format
log.transports.console.format = '[{y}-{m}-{d} {h}:{i}:{s}] [{level}] {text}';

module.exports = log;
```

**Gradually replace console.log**:
```javascript
// BEFORE:
console.log("Upload token created successfully");
console.error("Failed to create upload token:", error);

// AFTER:
const log = require('./shared/logger');
log.info("Upload token created successfully");
log.error("Failed to create upload token:", error);
```

**Approach**:
- Don't try to replace all 250+ at once
- Replace as you touch files during Phase 2 development
- Prioritize main.js functions you're actively working on

**Priority**: 🟡 **Incremental - replace as you modify files**

---

### 6. Add ESLint & Prettier Configuration

**Issue**: No code quality checks, inconsistent formatting

**Impact**: Code quality degrades over time, difficult code reviews

**Remediation** (Estimated: 1 hour):

**Install tools**:
```bash
npm install --save-dev eslint prettier eslint-config-prettier eslint-plugin-react
npx eslint --init
```

**Create `.eslintrc.js`**:
```javascript
module.exports = {
  env: {
    browser: true,
    node: true,
    es2021: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:react/recommended',
    'prettier',
  ],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: 'module',
    ecmaFeatures: {
      jsx: true,
    },
  },
  rules: {
    'no-console': process.env.NODE_ENV === 'production' ? 'warn' : 'off',
    'no-unused-vars': 'warn',
    'react/prop-types': 'off', // Can enable when adding TypeScript
  },
};
```

**Create `.prettierrc`**:
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

**Update package.json**:
```json
{
  "scripts": {
    "lint": "eslint src --ext .js,.jsx",
    "lint:fix": "eslint src --ext .js,.jsx --fix",
    "format": "prettier --write \"src/**/*.{js,jsx,json}\""
  }
}
```

**Priority**: 🟡 **Set up early in Phase 2, run periodically**

---

### 7. Split main.js Into Modules

**Issue**: 1,818-line file with multiple concerns

**Impact**: Hard to maintain, difficult to test, code navigation nightmare

**Affected**: `src/main.js`

**Remediation** (Estimated: 8-10 hours - **do incrementally**):

**Phase 2A - Extract Upload Token Creation**:
```bash
mkdir -p src/main/api
```

Create `src/main/api/recallai.js`:
```javascript
const axios = require('axios');
const log = require('../../shared/logger');

async function createDesktopSdkUpload() {
  const RECALLAI_API_URL = process.env.RECALLAI_API_URL || 'https://api.recall.ai';
  const RECALLAI_API_KEY = process.env.RECALLAI_API_KEY;

  if (!RECALLAI_API_KEY) {
    log.error("RECALLAI_API_KEY is missing");
    return null;
  }

  // ... rest of function
}

module.exports = { createDesktopSdkUpload };
```

**Phase 2B - Extract File Operations**:

Create `src/main/storage/FileManager.js`:
```javascript
const fs = require('fs');
const path = require('path');
const log = require('../../shared/logger');

class FileManager {
  constructor(meetingsFilePath) {
    this.meetingsFilePath = meetingsFilePath;
    this.cachedData = null;
    this.lastReadTime = 0;
  }

  async readMeetingsData() {
    // Move fileOperationManager.readMeetingsData logic here
  }

  async writeMeetingsData(data) {
    // Move fileOperationManager.writeData logic here
  }
}

module.exports = FileManager;
```

**Phase 2C - Extract LLM Service**:

Create `src/main/llm/SummaryGenerator.js`:
```javascript
const OpenAI = require('openai');
const log = require('../../shared/logger');

async function generateMeetingSummary(meeting, progressCallback = null) {
  // Move generateMeetingSummary logic here
}

module.exports = { generateMeetingSummary };
```

**Approach**:
- Don't try to refactor everything at once
- Extract 1 module at a time
- Test after each extraction
- Focus on modules you're actively working on in Phase 2

**Priority**: 🟡 **Incremental during Phase 2 - extract as you work**

---

## Medium-Priority Issues - Defer to Phase 3+

These can wait until later phases:

### 8. TypeScript Migration

**Issue**: Project claims TypeScript but uses JavaScript

**Impact**: No type safety, runtime errors, poor autocomplete

**Remediation Plan** (Estimated: 20-30 hours - **Phase 3 or later**):

**Don't migrate now because**:
- Would slow down Phase 2 development significantly
- Muesli baseline is JavaScript, stick with it for now
- Can add types incrementally later

**When to migrate**:
- After Phase 2 (Obsidian integration) is stable
- Before Phase 4 (Enhanced AI) - types will help with LLM provider abstraction
- Migrate incrementally starting with shared types

**Priority**: 🔵 **Defer to Phase 3 or later**

---

### 9. React Component Extraction

**Issue**: 2,004-line renderer.js monolith

**Impact**: Hard to maintain, can't reuse components

**Remediation Plan** (Estimated: 12-15 hours - **Phase 3 or later**):

**Target structure**:
```
src/renderer/
├── App.jsx (main orchestrator)
├── components/
│   ├── MeetingList.jsx
│   ├── MeetingCard.jsx
│   ├── MeetingEditor.jsx
│   ├── TranscriptView.jsx
│   └── RecordingControls.jsx
├── hooks/
│   ├── useMeetings.js
│   └── useRecording.js
└── styles/
```

**Don't extract now because**:
- Phase 2 focuses on backend (file generation, routing)
- UI changes minimal in Phase 2
- Will need to extract when adding Calendar UI (Phase 3)

**Priority**: 🔵 **Defer to Phase 3 (Calendar Integration)**

---

### 10. Comprehensive Testing

**Issue**: 0% test coverage

**Impact**: Bugs slip through, regressions during refactoring

**Remediation Plan** (Estimated: 30+ hours - **Ongoing from Phase 3**):

**Setup** (can do now, write tests later):
```bash
npm install --save-dev jest @testing-library/react @testing-library/jest-dom
```

**Priority**: 🔵 **Setup in Phase 3, write tests incrementally**

---

### 11. Memory Leak Prevention

**Issue**: Event listeners not cleaned up

**Impact**: Memory accumulation over long sessions

**Affected Areas**:
- IPC listeners in main.js (lines 100-112)
- SDK event listeners (lines 380-614)
- Renderer event listeners (multiple)

**Remediation**: Add cleanup in window/app close events

**Priority**: 🔵 **Defer to Phase 4+ (not critical for short sessions)**

---

## Low-Priority Issues - Monitor But Don't Fix Yet

### 12. Code Duplication

**Issue**: Repeated patterns (video file checking, upload token creation)

**Impact**: Maintenance burden when making changes

**Approach**: Refactor when touched during normal development

**Priority**: 🟢 **Opportunistic - fix when convenient**

---

### 13. XSS Vulnerabilities

**Issue**: Unsafe innerHTML usage in renderer

**Impact**: Potential XSS if malicious data in transcript

**Remediation**: Use textContent or DOMPurify

**Priority**: 🟢 **Low risk (data from trusted sources), defer to Phase 5+**

---

### 14. Environment Configuration

**Issue**: No dev/staging/production environment separation

**Impact**: Hard to test with different configs

**Priority**: 🟢 **Defer until deployment needs arise**

---

## Remediation Schedule

### Before Phase 2 Starts (1-2 days)
- [x] Consolidate Express server into main process
- [ ] Revoke and rotate API keys
- [ ] Update Electron to 36.8.1+
- [ ] Run npm audit fix
- [ ] Remove unused dependencies
- [ ] Set up ESLint + Prettier (don't fix all issues yet, just set up)

### During Phase 2 Development (Incremental)
- [ ] Replace console.log with electron-log (in files you touch)
- [ ] Add input validation (in IPC handlers you modify)
- [ ] Extract modules from main.js (as you add new features)
- [ ] Run linter periodically, fix critical issues

### Phase 3 and Beyond
- [ ] TypeScript migration (start with shared types)
- [ ] React component extraction
- [ ] Comprehensive testing
- [ ] Memory leak fixes
- [ ] Environment configuration

---

## Success Metrics

**Technical Debt Velocity**: Track ratio of new tech debt vs. remediated tech debt

**Goal**: Remediate at least as much as we add each phase

**Metrics to Track**:
- Lines of code per file (target: <500)
- Number of console.log statements (target: <50 by Phase 3)
- npm audit vulnerabilities (target: 0 high/critical)
- Test coverage (target: 50% by Phase 4)

---

## Quick Reference - What to Do When...

### Starting a New Phase
1. Review Critical and High-Priority issues
2. Address any blockers
3. Set up new tooling if needed (linting, testing)

### Adding a New Feature
1. Use existing patterns (don't introduce new tech debt)
2. Extract to module if adding >100 lines to main.js
3. Add validation for new IPC handlers
4. Replace console.log with proper logging

### Fixing a Bug
1. Check if bug is caused by known tech debt
2. If yes, fix root cause (not just symptom)
3. Add test to prevent regression

### Code Review Checklist
- [ ] No hardcoded secrets
- [ ] Input validation for external data
- [ ] Error handling present
- [ ] No console.log (use logger)
- [ ] Module size reasonable (<500 lines)
- [ ] Existing patterns followed

---

**Last Review**: November 6, 2025
**Next Review**: After Phase 2 completion
