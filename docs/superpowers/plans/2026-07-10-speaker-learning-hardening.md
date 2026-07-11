# Speaker-Learning Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close three deferred speaker-learning gaps before v2.0 release — teach corrections that lack a persisted embedding by re-embedding the audio, cap the profile centroid to the most recent 50 samples, and enforce one voice sample per profile+meeting at the schema level (v5) with a true upsert.

**Architecture:** Three cooperating changes in the Electron main process. (1) A schema v5 migration in `databaseService.js` de-duplicates existing `voice_samples`, adds a unique index on `(profile_id, meeting_id)`, converts the sample insert to `INSERT … ON CONFLICT … DO UPDATE`, and adds a per-meeting profile-id lookup. (2) `voiceProfileService.recomputeProfile` averages only the newest 50 samples (`MAX_CENTROID_SAMPLES`) while confidence still reflects the total count. (3) A new dependency-injected `correctionReembed.js` module re-embeds the meeting audio for a corrected speaker that carried no embedding, wired fire-and-forget into the Fix Speakers IPC handler; the historical backfill switches from a meeting-level skip to a per-identity skip so meetings previously sampled for other speakers are revisited.

**Tech Stack:** Electron main, better-sqlite3 (schema v4→v5, `PRAGMA user_version`), JD Audio Service `/embed-speakers` endpoint, Vitest.

---

## Context: verified current state (2026-07-10)

Read-only inspection of the real dev DB (`C:\Users\brigh\AppData\Roaming\jd-notes-things-dev\meetings.db`, opened with `{readonly:true}` via `ELECTRON_RUN_AS_NODE=1 npx electron`) confirmed the schema the migration must target. **Do not trust the spec's column guesses over this output.**

**Version mechanism:** tracked by `PRAGMA user_version` (not a table). `db.pragma('user_version')` -> `[{"user_version":4}]`. `databaseService.js` holds `const CURRENT_SCHEMA_VERSION = 4;` (line 21); fresh installs run `_createSchema()` then `pragma user_version = CURRENT`; upgrades run `_runMigrations(oldVersion)` with `if (oldVersion < N)` blocks.

**`PRAGMA table_info(voice_samples)`** (real output):
```
cid name        type    notnull dflt_value          pk
0   id          INTEGER 0       null                1
1   profile_id  INTEGER 1       null                0
2   meeting_id  TEXT    0       null                0
3   embedding   BLOB    1       null                0
4   duration    REAL    0       "0"                 0
5   created_at  TEXT    0       "datetime('now')"   0
```

**`PRAGMA table_info(voice_profiles)`** (real output): `id`(pk), `google_contact_id` TEXT, `contact_name` TEXT NOT NULL, `contact_email` TEXT, `embedding` BLOB NOT NULL, `sample_count` INTEGER dflt 1, `total_duration` REAL dflt 0, `confidence` REAL dflt 0.5, `created_at` TEXT, `updated_at` TEXT.

**Existing indexes on `voice_samples`:** only `idx_voice_samples_profile` -> `(profile_id)`, non-unique. There is **no** uniqueness on `(profile_id, meeting_id)` today.

**Data present:** `voice_profiles`: 83 rows. `voice_samples`: 309 rows. **15 duplicate `(profile_id, meeting_id)` groups exist right now** (all count = 2), e.g.:
```
profile_id  meeting_id                 c
2           meeting-1765844083018      2
2           meeting-1766437257178      2
2           meeting-1768424472904      2
2           meeting-1769466698663      2
2           meeting-1773952320488      2
```
Top per-profile counts: profile_id 2 -> 144 samples, profile 9 -> 12, profile 17 -> 8. **Because duplicates exist, `CREATE UNIQUE INDEX` will fail unless the migration de-duplicates first.** The migration MUST delete duplicates (keep newest) before creating the index.

**SQLite NULL semantics that shape the design:** a unique index on `(profile_id, meeting_id)` treats NULL `meeting_id` values as distinct, so anchor/manual samples with `meeting_id = NULL` never collide and `ON CONFLICT` never fires for them (plain insert). The dedupe query therefore only targets rows where `meeting_id IS NOT NULL`.

**Ordering for the recency window:** `created_at` is `TEXT` from `datetime('now')` (1-second resolution) — a single backfill run inserts many rows sharing one timestamp, so `created_at` alone is an ambiguous sort key. The autoincrement `id` is monotonic with insert order and is the reliable tiebreaker. Order by `created_at ASC, id ASC` (oldest->newest) and take the tail.

---

## File structure

- **`src/main/services/databaseService.js`** (modify) — schema version bump, v5 migration (dedupe + unique index), unique index in `_createSchema`, `insertVoiceSample` -> upsert, deterministic `getVoiceSamples` ordering, new `getSampledProfileIdsForMeeting`.
- **`src/main/services/voiceProfileService.js`** (modify) — `MAX_CENTROID_SAMPLES` constant + recency window in `recomputeProfile`; export the constant.
- **`src/main/services/voiceProfileBackfill.js`** (modify) — per-identity skip in `runBackfill`.
- **`src/main/services/correctionReembed.js`** (create) — dependency-injected re-embed for embedding-less corrections; reuses `synthesizeSegments`/`resolveAudioPath` from `voiceProfileBackfill.js`.
- **`src/main.js`** (modify) — import `synthesizeSegments`/`resolveAudioPath`; wire `reembedCorrections` fire-and-forget into `speakerMapping:applyToMeeting`; add per-identity deps to the backfill IPC wiring.
- **`tests/unit/voiceProfileService.test.js`** (modify) — recency-window test.
- **`tests/unit/voiceProfileBackfill.test.js`** (modify) — per-identity skip test; update existing skip test to the new dep shape.
- **`tests/unit/correctionReembed.test.js`** (create) — F1 hook tests.

**Baseline before starting:** `npx vitest run` = 318 passing (a `wasapiCapture` EADDRINUSE failure is environmental — ignore it; it is unrelated to these files). Zero ESLint warnings. Never kill running electron/ffmpeg processes. Migrations are written against the code's own `user_version` mechanism — never run SQL manually against the dev or production DB.

---
## Task 1: Schema v5 — dedupe, unique index, upsert, per-meeting profile lookup

**Files:**
- Modify: `src/main/services/databaseService.js:21` (version const)
- Modify: `src/main/services/databaseService.js:221-232` (`_createSchema` voice_samples + indexes)
- Modify: `src/main/services/databaseService.js:314-347` (add v5 migration after the v4 block)
- Modify: `src/main/services/databaseService.js:491-495` (`insertVoiceSample` statement + `getVoiceSamples` ordering)
- Modify: `src/main/services/databaseService.js:1436-1441` (add `getSampledProfileIdsForMeeting` after `countVoiceSamplesForMeeting`)

This task has no unit test of its own (the DB layer is exercised through the service tests in later tasks and by app runtime; the schema change is verified by the manual checklist in Task 5). Its correctness gate is: `npx vitest run` stays green and `npm run lint` is clean.

- [ ] **Step 1: Bump the schema version constant**

Current (`databaseService.js:21`): `const CURRENT_SCHEMA_VERSION = 4;`
Replace with: `const CURRENT_SCHEMA_VERSION = 5;`

- [ ] **Step 2: Add the unique index to fresh-install schema**

Current (`databaseService.js:230-232`), the three index lines at the end of the voice tables block inside `_createSchema`:
```javascript
      CREATE INDEX IF NOT EXISTS idx_voice_profiles_email ON voice_profiles(contact_email);
      CREATE INDEX IF NOT EXISTS idx_voice_profiles_contact ON voice_profiles(google_contact_id);
      CREATE INDEX IF NOT EXISTS idx_voice_samples_profile ON voice_samples(profile_id);
```
Replace with (append the unique index; fresh DBs have no duplicates, so it is safe here):
```javascript
      CREATE INDEX IF NOT EXISTS idx_voice_profiles_email ON voice_profiles(contact_email);
      CREATE INDEX IF NOT EXISTS idx_voice_profiles_contact ON voice_profiles(google_contact_id);
      CREATE INDEX IF NOT EXISTS idx_voice_samples_profile ON voice_samples(profile_id);
      -- v5: one sample per profile per meeting (NULL meeting_id rows stay distinct).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_samples_profile_meeting
        ON voice_samples(profile_id, meeting_id);
```

- [ ] **Step 3: Add the v4->v5 migration block**

The tail of `_runMigrations` (`databaseService.js:314-347`) ends with the `if (oldVersion < 4)` block (which builds voice_profiles/voice_samples via `this.db.exec(...)`). Do NOT change that block. Insert a new `if (oldVersion < 5)` block **immediately before the closing `}` of the `_runMigrations` method** (after the v4 block's closing brace and its `log.info('[Database] v3 → v4 migration complete');`):
```javascript
    if (oldVersion < 5) {
      log.info('[Database] Running v4 → v5 migration: dedupe voice_samples + unique (profile_id, meeting_id) index');
      const migratev5 = this.db.transaction(() => {
        // Pre-migration cleanup: an established DB has duplicate (profile_id,
        // meeting_id) rows (verified 2026-07-10: 15 groups). CREATE UNIQUE INDEX
        // would fail on them, so delete duplicates first, keeping the newest row
        // per pair (highest id — id is monotonic with insert order). NULL
        // meeting_id rows are left alone: the unique index treats them as
        // distinct, so they never conflict.
        this.db.exec(`
          DELETE FROM voice_samples
          WHERE meeting_id IS NOT NULL
            AND id NOT IN (
              SELECT MAX(id) FROM voice_samples
              WHERE meeting_id IS NOT NULL
              GROUP BY profile_id, meeting_id
            );

          CREATE UNIQUE INDEX IF NOT EXISTS idx_voice_samples_profile_meeting
            ON voice_samples(profile_id, meeting_id);
        `);
      });
      migratev5();
      log.info('[Database] v4 → v5 migration complete');
    }
```

- [ ] **Step 4: Convert the sample insert to an upsert and make sample reads deterministic**

Current (`databaseService.js:491-495`), inside `_prepareStatements`:
```javascript
      // Voice samples
      insertVoiceSample: this.db.prepare(`
        INSERT INTO voice_samples (profile_id, meeting_id, embedding, duration)
        VALUES (@profile_id, @meeting_id, @embedding, @duration)
      `),
      getVoiceSamples: this.db.prepare('SELECT * FROM voice_samples WHERE profile_id = ?'),
```
Replace with (upsert on the v5 unique index; NULL `meeting_id` -> no conflict -> plain insert; deterministic ascending order so the service can take the newest tail):
```javascript
      // Voice samples. Upsert on the v5 unique (profile_id, meeting_id) index so
      // re-corrections replace rather than duplicate. NULL meeting_id rows never
      // conflict (SQLite treats NULLs as distinct), so they always insert.
      insertVoiceSample: this.db.prepare(`
        INSERT INTO voice_samples (profile_id, meeting_id, embedding, duration)
        VALUES (@profile_id, @meeting_id, @embedding, @duration)
        ON CONFLICT(profile_id, meeting_id) DO UPDATE SET
          embedding = excluded.embedding,
          duration = excluded.duration,
          created_at = datetime('now')
      `),
      // Ascending by insert order (created_at is 1s-resolution TEXT; id is the
      // monotonic tiebreaker) so recomputeProfile can slice the newest N.
      getVoiceSamples: this.db.prepare(
        'SELECT * FROM voice_samples WHERE profile_id = ? ORDER BY created_at ASC, id ASC'
      ),
      getSampledProfileIds: this.db.prepare(
        'SELECT DISTINCT profile_id FROM voice_samples WHERE meeting_id = ?'
      ),
```

- [ ] **Step 5: Add the `getSampledProfileIdsForMeeting` public method**

Insert directly after `countVoiceSamplesForMeeting` (`databaseService.js:1436-1441`), before `deleteVoiceSamples`. Leave `countVoiceSamplesForMeeting` in place — it is harmless and still available:
```javascript
  /**
   * Distinct profile ids that already have a voice sample from a given meeting.
   * Backs the backfill / re-embed per-identity skip: an identity is only
   * skipped for meetings its profile already contributed to.
   * @param {string} meetingId
   * @returns {number[]}
   */
  getSampledProfileIdsForMeeting(meetingId) {
    return this._stmts.getSampledProfileIds.all(meetingId).map(r => r.profile_id);
  }
```

- [ ] **Step 6: Run the full unit suite — must stay green**

Run: `npx vitest run`
Expected: 318 passing (ignore the environmental `wasapiCapture` EADDRINUSE failure if present). No new failures from the DB changes.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: zero errors, zero warnings.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/databaseService.js
git commit -m "feat(db): schema v5 dedupe voice_samples, unique (profile_id, meeting_id) index, upsert

Adds a v4->v5 migration that deletes duplicate voice_samples (keeping the newest
per profile+meeting) then creates a unique index, enforcing one sample per
profile per meeting at the schema level. insertVoiceSample now upserts on
conflict. Adds getSampledProfileIdsForMeeting for per-identity skip logic and
orders getVoiceSamples deterministically for the centroid recency window.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
## Task 2: Centroid recency window — newest 50 samples only

**Files:**
- Modify: `src/main/services/voiceProfileService.js:33-40` (add `MAX_CENTROID_SAMPLES` after `SAMPLE_REJECT_DISTANCE`)
- Modify: `src/main/services/voiceProfileService.js:322-350` (`recomputeProfile`)
- Modify: `src/main/services/voiceProfileService.js:847-859` (exports)
- Test: `tests/unit/voiceProfileService.test.js`

- [ ] **Step 1: Write the failing test**

Add `MAX_CENTROID_SAMPLES` to the destructured `require(...voiceProfileService.js)` at the top of `tests/unit/voiceProfileService.test.js` (the import block spanning lines 15-25). Then append this describe block to the file. The file's `makeDb` fake returns samples in insertion order (matching the real ascending `getVoiceSamples` ordering), so tail-slicing selects the newest:
```javascript
describe('recomputeProfile — centroid recency window', () => {
  it('averages only the newest MAX_CENTROID_SAMPLES samples, excluding older ones', () => {
    const db = makeDb();
    const svc = new VoiceProfileService(db);

    // Found the profile with one sample so recompute has something to load.
    const { id } = svc.saveProfile({
      contactName: 'JD',
      contactEmail: 'jd@x.com',
      embedding: new Float32Array([0, 1]),
      sampleCount: 1,
      totalDuration: 1,
      confidence: 0.5,
    });

    // 10 OLD samples pointing at +Y, then 50 NEW samples pointing at +X.
    // With a 50-sample window the centroid must be pure +X (old +Y excluded).
    for (let i = 0; i < 10; i++) svc.addSample(id, `old-${i}`, new Float32Array([0, 1]), 1);
    for (let i = 0; i < MAX_CENTROID_SAMPLES; i++) {
      svc.addSample(id, `new-${i}`, new Float32Array([1, 0]), 1);
    }

    svc.recomputeProfile(id);
    const profile = svc.getProfile(id);

    // Newest 50 are all +X -> centroid ~[1, 0]. If old +Y samples leaked in,
    // the Y component would be non-trivially positive.
    expect(profile.embedding[0]).toBeCloseTo(1, 5);
    expect(profile.embedding[1]).toBeCloseTo(0, 5);

    // Confidence still reflects the TOTAL sample count (61), capped at 0.95.
    expect(profile.sampleCount).toBe(61);
    expect(profile.confidence).toBeCloseTo(0.95, 5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/voiceProfileService.test.js -t "centroid recency window"`
Expected: FAIL — `MAX_CENTROID_SAMPLES` is `undefined` (not yet exported), so the loop count is wrong and the centroid still includes the old +Y samples (Y component not ~0).

- [ ] **Step 3: Add the constant**

Insert after `SAMPLE_REJECT_DISTANCE` (`voiceProfileService.js:34`), before the `MIN_AUTO_ENROLL_SECONDS` doc comment:
```javascript
/** Centroid recency window: recomputeProfile averages only the most recent
 *  samples so drift (new mic, new room) is absorbed instead of being diluted by
 *  a large history. Older samples stay in the table for audit/count but stop
 *  moving the centroid. Confidence still uses the TOTAL sample count. */
const MAX_CENTROID_SAMPLES = 50;
```

- [ ] **Step 4: Apply the recency window in `recomputeProfile`**

Current (`voiceProfileService.js:322-350`):
```javascript
  recomputeProfile(profileId) {
    const samples = this.getSamples(profileId);
    if (samples.length === 0) {
      log.warn(`${LOG_PREFIX} recomputeProfile: no samples for profile ${profileId}`);
      return false;
    }

    const avgEmbedding = weightedAverageEmbedding(samples);
    const sampleCount = samples.length;
    const totalDuration = samples.reduce((sum, s) => sum + (s.duration ?? 0), 0);
    const confidence = Math.min(0.5 + 0.05 * sampleCount, 0.95);

    const existing = this.getProfile(profileId);
    if (!existing) {
      log.warn(`${LOG_PREFIX} recomputeProfile: profile ${profileId} not found`);
      return false;
    }

    this.saveProfile({
      ...existing,
      embedding: avgEmbedding,
      sampleCount,
      totalDuration,
      confidence,
    });

    log.info(`${LOG_PREFIX} Recomputed profile ${profileId}: ${sampleCount} samples, confidence=${confidence.toFixed(3)}`);
    return true;
  }
```
Replace with (centroid from newest `MAX_CENTROID_SAMPLES`; count/duration/confidence from the full history; `getSamples` returns oldest->newest, so the newest window is the tail):
```javascript
  recomputeProfile(profileId) {
    const samples = this.getSamples(profileId);
    if (samples.length === 0) {
      log.warn(`${LOG_PREFIX} recomputeProfile: no samples for profile ${profileId}`);
      return false;
    }

    // Recency window: the centroid is the duration-weighted average of only the
    // newest MAX_CENTROID_SAMPLES samples (getSamples returns oldest->newest, so
    // the newest window is the tail). Sample count, total duration, and
    // confidence still reflect the FULL history — the window only bounds which
    // samples move the embedding, so drift is absorbed quickly.
    const centroidSamples =
      samples.length > MAX_CENTROID_SAMPLES ? samples.slice(-MAX_CENTROID_SAMPLES) : samples;

    const avgEmbedding = weightedAverageEmbedding(centroidSamples);
    const sampleCount = samples.length;
    const totalDuration = samples.reduce((sum, s) => sum + (s.duration ?? 0), 0);
    const confidence = Math.min(0.5 + 0.05 * sampleCount, 0.95);

    const existing = this.getProfile(profileId);
    if (!existing) {
      log.warn(`${LOG_PREFIX} recomputeProfile: profile ${profileId} not found`);
      return false;
    }

    this.saveProfile({
      ...existing,
      embedding: avgEmbedding,
      sampleCount,
      totalDuration,
      confidence,
    });

    log.info(
      `${LOG_PREFIX} Recomputed profile ${profileId}: centroid from ${centroidSamples.length}/${sampleCount} samples, confidence=${confidence.toFixed(3)}`
    );
    return true;
  }
```

- [ ] **Step 5: Export the constant**

In the `module.exports` block (`voiceProfileService.js:847-859`), add `MAX_CENTROID_SAMPLES,` on its own line between `SAMPLE_REJECT_DISTANCE,` and `MIN_AUTO_ENROLL_SECONDS,`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/unit/voiceProfileService.test.js -t "centroid recency window"`
Expected: PASS.

- [ ] **Step 7: Run the full service test file**

Run: `npx vitest run tests/unit/voiceProfileService.test.js`
Expected: all existing tests plus the new one PASS.

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: zero errors, zero warnings.

- [ ] **Step 9: Commit**

```bash
git add src/main/services/voiceProfileService.js tests/unit/voiceProfileService.test.js
git commit -m "feat(voice): centroid recency window (newest 50 samples)

recomputeProfile now averages only the most recent MAX_CENTROID_SAMPLES=50
samples so profile drift (new mic/room) is absorbed instead of being diluted by
a long history. Older samples stay in the table; sample count and confidence
still reflect the full history.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
## Task 3: Backfill per-identity skip

**Files:**
- Modify: `src/main/services/voiceProfileBackfill.js:120-131` (`runBackfill` docstring deps)
- Modify: `src/main/services/voiceProfileBackfill.js:195-254` (`runBackfill` skip + embed logic)
- Test: `tests/unit/voiceProfileBackfill.test.js`

The meeting-level skip (`countVoiceSamplesForMeeting(meeting.id) > 0`) is replaced by a per-identity skip driven by two new injected deps: `getSampledProfileIdsForMeeting(meetingId) => number[]` and `getProfileIdByEmail(email) => number|null`. A meeting is embedded whenever at least one of its verified identities has NOT yet contributed a sample from it; only the missing identities are embedded and upserted.

- [ ] **Step 1: Update the existing tests to the new dep shape and add a per-identity revisit test**

In `tests/unit/voiceProfileBackfill.test.js`, replace the existing test `it('embeds qualifying meetings, upserts per identity, skips already-sampled and missing-audio meetings', ...)` (lines 136-182) with the version below. `m-sampled`'s only identity (JD -> profile 1) is already sampled for it, so the whole meeting is skipped:
```javascript
  it('embeds qualifying meetings, upserts per identity, skips fully-sampled and missing-audio meetings', async () => {
    const meetings = [
      {
        id: 'm-good',
        videoFile: 'C:/audio/good.mp3',
        transcript: [T('S0', 'JD', 'jd@x.com', 0, 60000), T('S1', 'Kurt', 'kurt@x.com', 60000, 120000)],
      },
      { id: 'm-sampled', videoFile: 'C:/audio/sampled.mp3', transcript: [T('S0', 'JD', 'jd@x.com', 0, 60000)] },
      { id: 'm-noaudio', videoFile: 'C:/audio/missing.mp3', transcript: [T('S0', 'JD', 'jd@x.com', 0, 60000)] },
      { id: 'm-unverified', videoFile: 'C:/audio/good2.mp3', transcript: [T('S0', 'Speaker A', null, 0, 60000)] },
    ];
    const profileIdByEmail = { 'jd@x.com': 1, 'kurt@x.com': 2 };
    const deps = {
      getAllMeetings: () => ({ upcomingMeetings: [], pastMeetings: meetings }),
      getSampledProfileIdsForMeeting: id => (id === 'm-sampled' ? [1] : []),
      getProfileIdByEmail: email => profileIdByEmail[email] ?? null,
      fileExists: p => p !== 'C:/audio/missing.mp3',
      embedSpeakers: vi.fn().mockImplementation(async (_path, segments) =>
        [...new Set(segments.map(s => s.speaker))].map(label => ({
          speakerLabel: label,
          embedding: new Float32Array([1, 0]),
        }))
      ),
      upsertProfileSample: vi.fn().mockReturnValue({ profileId: 1, created: true }),
      log: () => {},
    };

    const summary = await runBackfill(deps, { onProgress: () => {} });

    expect(deps.embedSpeakers).toHaveBeenCalledTimes(1); // only m-good
    expect(deps.upsertProfileSample).toHaveBeenCalledTimes(2); // JD + Kurt
    expect(summary).toMatchObject({
      scanned: 4,
      embedded: 1,
      samplesAdded: 2,
      samplesRejected: 0,
      skippedAlreadySampled: 1,
      skippedNoAudio: 1,
      skippedNoIdentities: 1,
    });
  });

  it('revisits a meeting for identities that have not yet contributed a sample', async () => {
    // m1 already has a sample from A (profile 1) but NOT from B (profile 2).
    // Per-identity skip: embed again, but only for B — A is skipped.
    const meetings = [
      { id: 'm1', videoFile: 'C:/audio/m1.mp3',
        transcript: [T('A', 'Alice', 'a@x.com', 0, 60000), T('B', 'Bob', 'b@x.com', 60000, 120000)] },
    ];
    const profileIdByEmail = { 'a@x.com': 1, 'b@x.com': 2 };
    const deps = {
      getAllMeetings: () => ({ upcomingMeetings: [], pastMeetings: meetings }),
      getSampledProfileIdsForMeeting: () => [1], // A already sampled from m1
      getProfileIdByEmail: email => profileIdByEmail[email] ?? null,
      fileExists: () => true,
      embedSpeakers: vi.fn().mockImplementation(async (_path, segments) =>
        [...new Set(segments.map(s => s.speaker))].map(label => ({
          speakerLabel: label,
          embedding: new Float32Array([1, 0]),
        }))
      ),
      upsertProfileSample: vi.fn().mockReturnValue({ profileId: 2, created: true }),
      log: () => {},
    };

    const summary = await runBackfill(deps);

    expect(deps.embedSpeakers).toHaveBeenCalledTimes(1);
    const sentSegments = deps.embedSpeakers.mock.calls[0][1];
    expect([...new Set(sentSegments.map(s => s.speaker))]).toEqual(['B']);
    expect(deps.upsertProfileSample).toHaveBeenCalledTimes(1);
    expect(deps.upsertProfileSample).toHaveBeenCalledWith(
      expect.objectContaining({ contactEmail: 'b@x.com' }),
      expect.anything(),
      expect.anything(),
      'm1'
    );
    expect(summary).toMatchObject({ embedded: 1, samplesAdded: 1 });
  });
```

Also update the two other tests that inject `countVoiceSamplesForMeeting`. In `it('resolves email display names via the optional resolver, falling back to the email', ...)` (lines 10-37) and `it('counts poisoning-guard rejections separately from added samples', ...)` (lines 184-216), replace the single line `countVoiceSamplesForMeeting: () => 0,` in each `deps` object with these two lines:
```javascript
      getSampledProfileIdsForMeeting: () => [],
      getProfileIdByEmail: () => null,
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/voiceProfileBackfill.test.js`
Expected: FAIL — `runBackfill` still calls `deps.countVoiceSamplesForMeeting` (now undefined -> TypeError) and does not restrict embedding to pending identities, so the revisit test's `sentSegments`/call-count assertions fail.

- [ ] **Step 3: Rewrite the skip + embed logic in `runBackfill`**

Current (`voiceProfileBackfill.js:195-214`), the per-meeting body up to the embed call:
```javascript
    try {
      const audioPath = resolveAudioPath(meeting, deps);
      if (!audioPath) {
        summary.skippedNoAudio++;
        continue;
      }
      if (deps.countVoiceSamplesForMeeting(meeting.id) > 0) {
        summary.skippedAlreadySampled++;
        continue;
      }
      const identities = extractSpeakerIdentities(meeting.transcript || []);
      if (Object.keys(identities).length === 0) {
        summary.skippedNoIdentities++;
        continue;
      }
      const segments = synthesizeSegments(meeting.transcript, identities);
      if (segments.length === 0) {
        summary.skippedNoIdentities++;
        continue;
      }

      const embeddings = await deps.embedSpeakers(audioPath, segments);
```
Replace with (per-identity skip: drop identities whose profile already has a sample from this meeting; skip the whole meeting only if none remain):
```javascript
    try {
      const audioPath = resolveAudioPath(meeting, deps);
      if (!audioPath) {
        summary.skippedNoAudio++;
        continue;
      }
      const identities = extractSpeakerIdentities(meeting.transcript || []);
      if (Object.keys(identities).length === 0) {
        summary.skippedNoIdentities++;
        continue;
      }

      // Per-identity skip: an identity is skipped for this meeting only if its
      // profile already contributed a sample from it. Meetings previously
      // sampled for OTHER speakers are revisited for the missing ones. An
      // identity with no profile yet (getProfileIdByEmail -> null) is never
      // "already sampled", so it is always pending.
      const sampledProfileIds = new Set(deps.getSampledProfileIdsForMeeting(meeting.id));
      const pendingIdentities = {};
      for (const [label, identity] of Object.entries(identities)) {
        const pid = deps.getProfileIdByEmail(identity.email);
        if (pid != null && sampledProfileIds.has(pid)) continue;
        pendingIdentities[label] = identity;
      }
      if (Object.keys(pendingIdentities).length === 0) {
        summary.skippedAlreadySampled++;
        continue;
      }

      const segments = synthesizeSegments(meeting.transcript, pendingIdentities);
      if (segments.length === 0) {
        summary.skippedNoIdentities++;
        continue;
      }

      const embeddings = await deps.embedSpeakers(audioPath, segments);
```
Then in the embeddings loop that follows (`voiceProfileBackfill.js:219-221`), change the identity lookup from `identities` to `pendingIdentities`:
```javascript
      for (const emb of embeddings) {
        const identity = identities[emb.speakerLabel];
        if (!identity) continue;
```
becomes:
```javascript
      for (const emb of embeddings) {
        const identity = pendingIdentities[emb.speakerLabel];
        if (!identity) continue;
```
And the per-meeting summary log line near the end (`voiceProfileBackfill.js:252-254`):
```javascript
      deps.log(
        `[Backfill] ${meeting.id}: ${Object.keys(identities).length} identities, +${embeddings.length} embeddings`
      );
```
becomes:
```javascript
      deps.log(
        `[Backfill] ${meeting.id}: ${Object.keys(pendingIdentities).length} pending identities, +${embeddings.length} embeddings`
      );
```

- [ ] **Step 4: Update the `runBackfill` JSDoc deps list**

In the `@param` block for `deps` (`voiceProfileBackfill.js:120-123`), replace the `deps.countVoiceSamplesForMeeting` line with the two new dep lines:
```javascript
 * @param {Function} deps.getSampledProfileIdsForMeeting - (meetingId) => number[];
 *   profile ids that already have a sample from the meeting (per-identity skip)
 * @param {Function} deps.getProfileIdByEmail - (email) => number|null; resolves a
 *   verified identity's existing profile id, or null if not yet enrolled
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/voiceProfileBackfill.test.js`
Expected: PASS (all existing + the two updated/new tests).

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: zero errors, zero warnings.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/voiceProfileBackfill.js tests/unit/voiceProfileBackfill.test.js
git commit -m "feat(voice): backfill per-identity skip

runBackfill no longer skips an entire meeting once it has any sample. It now
skips only the identities whose profile already contributed from that meeting,
embedding just the missing ones. Meetings previously sampled for other speakers
are revisited. Uses new getSampledProfileIdsForMeeting / getProfileIdByEmail deps.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
## Task 4: F1 re-embed on embedding-less corrections

**Files:**
- Create: `src/main/services/correctionReembed.js`
- Test: `tests/unit/correctionReembed.test.js`
- Modify: `src/main.js:73` (import backfill helpers + `reembedCorrections`)
- Modify: `src/main.js:5876-5907` (collect re-embed targets + fire-and-forget call in the learning hook)
- Modify: `src/main.js:6975-6979` (add per-identity deps to the backfill IPC wiring — completes Task 3's wiring)

The re-embed logic lives in a dependency-injected module so it is unit-testable (main.js itself is not). `main.js` calls it fire-and-forget: the correction is already applied and saved; embedding work never blocks it, and any failure (unreachable audio service, missing audio) only logs.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/correctionReembed.test.js`:
```javascript
import { describe, it, expect, vi } from 'vitest';
import { reembedCorrections } from '../../src/main/services/correctionReembed.js';

const T = (speaker, name, email, startMs, endMs) => ({
  speaker,
  speakerName: name,
  speakerEmail: email,
  text: 'x'.repeat(30),
  timestamp: startMs,
  endTimestamp: endMs,
});

function baseDeps(overrides = {}) {
  return {
    fileExists: () => true,
    recordingsDirs: ['C:/rec'],
    embedSpeakers: vi.fn().mockResolvedValue([{ speakerLabel: 'S0', embedding: new Float32Array([1, 0]) }]),
    upsertProfileSample: vi.fn().mockReturnValue({ profileId: 1, created: true }),
    log: () => {},
    warn: () => {},
    ...overrides,
  };
}

describe('reembedCorrections', () => {
  it('embeds the corrected label and upserts with the real synthesized duration', async () => {
    const meeting = { videoFile: 'C:/rec/a.mp3', transcript: [T('S0', 'S0', null, 0, 90000)] };
    const targets = [{ speakerLabel: 'S0', name: 'Kurt Anderson', email: 'kurt@x.com' }];
    const deps = baseDeps();

    const summary = await reembedCorrections(deps, meeting, targets, 'm1');

    expect(deps.embedSpeakers).toHaveBeenCalledTimes(1);
    const [audioPath, segments] = deps.embedSpeakers.mock.calls[0];
    expect(audioPath).toBe('C:/rec/a.mp3');
    expect([...new Set(segments.map(s => s.speaker))]).toEqual(['S0']);
    expect(deps.upsertProfileSample).toHaveBeenCalledWith(
      { contactName: 'Kurt Anderson', contactEmail: 'kurt@x.com', googleContactId: null },
      expect.any(Float32Array),
      expect.any(Number),
      'm1'
    );
    const passedDuration = deps.upsertProfileSample.mock.calls[0][2];
    expect(passedDuration).toBeGreaterThan(0);
    expect(summary).toMatchObject({ embedded: 1, samplesAdded: 1, samplesRejected: 0 });
  });

  it('skips silently when no local audio is resolvable (cloud-only meeting)', async () => {
    const meeting = { transcript: [T('S0', 'S0', null, 0, 90000)] };
    const deps = baseDeps({ fileExists: () => false, embedSpeakers: vi.fn() });

    const summary = await reembedCorrections(deps, meeting, [{ speakerLabel: 'S0', name: 'K', email: 'k@x.com' }], 'm1');

    expect(deps.embedSpeakers).not.toHaveBeenCalled();
    expect(deps.upsertProfileSample).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ embedded: 0, skippedNoAudio: true });
  });

  it('returns without throwing when the audio service is unreachable', async () => {
    const meeting = { videoFile: 'C:/rec/a.mp3', transcript: [T('S0', 'S0', null, 0, 90000)] };
    const deps = baseDeps({ embedSpeakers: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) });

    const summary = await reembedCorrections(deps, meeting, [{ speakerLabel: 'S0', name: 'K', email: 'k@x.com' }], 'm1');

    expect(deps.upsertProfileSample).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ embedded: 0, error: 'ECONNREFUSED' });
  });

  it('counts poisoning-guard rejections separately', async () => {
    const meeting = { videoFile: 'C:/rec/a.mp3', transcript: [T('S0', 'S0', null, 0, 90000)] };
    const deps = baseDeps({
      upsertProfileSample: vi.fn().mockReturnValue({ profileId: 1, created: false, rejected: true }),
    });

    const summary = await reembedCorrections(deps, meeting, [{ speakerLabel: 'S0', name: 'K', email: 'k@x.com' }], 'm1');

    expect(summary).toMatchObject({ embedded: 1, samplesAdded: 0, samplesRejected: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/correctionReembed.test.js`
Expected: FAIL — `Cannot find module '../../src/main/services/correctionReembed.js'`.

- [ ] **Step 3: Create the `correctionReembed.js` module**

Create `src/main/services/correctionReembed.js`:
```javascript
/**
 * Correction Re-embed (spec F1)
 *
 * When a Fix Speakers correction lands on a label that has no persisted
 * embedding (track-anchored, auto-matched, or pending labels often carry none),
 * the correction otherwise teaches the voice profiles nothing. This module
 * re-embeds the meeting audio for just the corrected label(s) and feeds the
 * result through upsertProfileSample so the correction becomes a voice sample
 * for the RIGHT person.
 *
 * Reuses the backfill's pure segment/audio helpers (synthesizeSegments,
 * resolveAudioPath) so legacy missing-end-timestamps and the 90s/speaker cap
 * are handled identically. Dependency-injected and non-throwing: the caller
 * runs it fire-and-forget, so the correction is never blocked by embedding
 * work. A cloud-only meeting (no local audio) or an unreachable audio service
 * is a silent skip / warning, not an error.
 */

const { synthesizeSegments, resolveAudioPath } = require('./voiceProfileBackfill');

/**
 * @param {Object} deps
 * @param {Function} deps.fileExists - (path) => boolean
 * @param {string[]} deps.recordingsDirs - dirs to probe for convention-named audio
 * @param {Function} deps.embedSpeakers - (audioPath, segments) => Promise<Array<{speakerLabel, embedding}>>
 * @param {Function} deps.upsertProfileSample - (contact, embedding, durationSec, meetingId) => {profileId, created, rejected?}|null
 * @param {Function} [deps.log] - (msg) => void
 * @param {Function} [deps.warn] - (msg) => void
 * @param {{videoFile?: string, recordingId?: string, transcript?: Array}} meeting
 * @param {Array<{speakerLabel: string, name: string, email: string}>} targets - corrected labels lacking an embedding
 * @param {string} meetingId
 * @returns {Promise<{embedded: number, samplesAdded: number, samplesRejected: number,
 *   skippedNoAudio?: boolean, skippedNoSegments?: boolean, error?: string}>}
 */
async function reembedCorrections(deps, meeting, targets, meetingId) {
  const log = deps.log || (() => {});
  const warn = deps.warn || (() => {});
  const summary = { embedded: 0, samplesAdded: 0, samplesRejected: 0 };

  if (!Array.isArray(targets) || targets.length === 0) return summary;

  try {
    const audioPath = resolveAudioPath(meeting, {
      fileExists: deps.fileExists,
      recordingsDirs: deps.recordingsDirs,
    });
    if (!audioPath) {
      log(`[CorrectionReembed] No local audio for ${meetingId} — skipping (cloud-only meeting)`);
      summary.skippedNoAudio = true;
      return summary;
    }

    // Restrict synthesized segments to the corrected labels only.
    const identities = {};
    for (const t of targets) identities[t.speakerLabel] = { name: t.name, email: t.email };
    const segments = synthesizeSegments(meeting.transcript || [], identities);
    if (segments.length === 0) {
      log(`[CorrectionReembed] No usable segments for ${meetingId} — nothing to embed`);
      summary.skippedNoSegments = true;
      return summary;
    }

    const embeddings = await deps.embedSpeakers(audioPath, segments);
    summary.embedded = 1;

    for (const emb of embeddings) {
      const target = targets.find(t => t.speakerLabel === emb.speakerLabel);
      if (!target) continue;
      const durationSec = segments
        .filter(s => s.speaker === emb.speakerLabel)
        .reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
      const upsert = deps.upsertProfileSample(
        { contactName: target.name, contactEmail: target.email, googleContactId: null },
        emb.embedding,
        durationSec,
        meetingId
      );
      if (upsert?.rejected) {
        summary.samplesRejected++;
        log(`[CorrectionReembed] Sample for ${target.name} rejected by poisoning guard in ${meetingId}`);
      } else if (upsert) {
        summary.samplesAdded++;
        log(
          `[CorrectionReembed] ${target.name} ${upsert.created ? 'enrolled' : 'strengthened'} ` +
            `via re-embed of ${emb.speakerLabel} in ${meetingId}`
        );
      }
    }
  } catch (err) {
    summary.error = err.message;
    warn(`[CorrectionReembed] Re-embed failed for ${meetingId} (correction still applied): ${err.message}`);
  }

  return summary;
}

module.exports = { reembedCorrections };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/correctionReembed.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Import the backfill helpers and the new module in main.js**

Current (`src/main.js:73`):
```javascript
const { runBackfill } = require('./main/services/voiceProfileBackfill');
```
Replace with:
```javascript
const { runBackfill } = require('./main/services/voiceProfileBackfill');
const { reembedCorrections } = require('./main/services/correctionReembed');
```
(`correctionReembed` imports `synthesizeSegments`/`resolveAudioPath` itself, so main.js does not need them directly.)

- [ ] **Step 6: Collect re-embed targets in the learning hook instead of logging a skip**

Current (`src/main.js:5876-5907`), the correction-enrollment loop:
```javascript
      if (voiceProfileService) {
        for (const c of corrections) {
          const entry = prevMapping[c.speakerLabel];
          if (entry?.embedding?.length > 0 && c.toEmail) {
            // Weight the correction by how long this speaker actually spoke —
            // recompute weights samples by duration, so a 0 here would make the
            // correction essentially weightless against anchor samples.
            const correctionDuration = (meeting.segments || [])
              .filter(s => s.speaker === c.speakerLabel)
              .reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
            const upsert = voiceProfileService.upsertProfileSample(
              { contactName: c.toName, contactEmail: c.toEmail, googleContactId: null },
              new Float32Array(entry.embedding),
              correctionDuration,
              meetingId
            );
            if (upsert?.rejected) {
              console.log(
                `[CorrectionEnroll] Sample for ${c.toName} rejected by poisoning guard (embedding does not match their established profile)`
              );
            } else if (upsert) {
              console.log(
                `[CorrectionEnroll] ${c.toName} ${upsert.created ? 'enrolled' : 'strengthened'} from correction of ${c.speakerLabel}`
              );
            }
          } else if (c.toEmail) {
            console.log(
              `[CorrectionEnroll] No embedding available for ${c.speakerLabel} — backfill can cover this meeting later`
            );
          }
        }
      }
```
Replace with (embedding-less corrections feed a `reembedTargets` list; the fire-and-forget re-embed is scheduled after the loop):
```javascript
      if (voiceProfileService) {
        const reembedTargets = [];
        for (const c of corrections) {
          const entry = prevMapping[c.speakerLabel];
          if (entry?.embedding?.length > 0 && c.toEmail) {
            // Weight the correction by how long this speaker actually spoke —
            // recompute weights samples by duration, so a 0 here would make the
            // correction essentially weightless against anchor samples.
            const correctionDuration = (meeting.segments || [])
              .filter(s => s.speaker === c.speakerLabel)
              .reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0);
            const upsert = voiceProfileService.upsertProfileSample(
              { contactName: c.toName, contactEmail: c.toEmail, googleContactId: null },
              new Float32Array(entry.embedding),
              correctionDuration,
              meetingId
            );
            if (upsert?.rejected) {
              console.log(
                `[CorrectionEnroll] Sample for ${c.toName} rejected by poisoning guard (embedding does not match their established profile)`
              );
            } else if (upsert) {
              console.log(
                `[CorrectionEnroll] ${c.toName} ${upsert.created ? 'enrolled' : 'strengthened'} from correction of ${c.speakerLabel}`
              );
            }
          } else if (c.toEmail) {
            // F1: no persisted embedding for this label. Re-embed the meeting
            // audio for the corrected label so the correction still teaches the
            // right person's profile. Collected here, run fire-and-forget below.
            reembedTargets.push({ speakerLabel: c.speakerLabel, name: c.toName, email: c.toEmail });
          }
        }

        // Fire-and-forget re-embed (spec F1): the correction is already applied
        // and about to be saved — embedding work must never block or fail it.
        if (reembedTargets.length > 0) {
          const reembedDeps = {
            fileExists: p => fs.existsSync(p),
            recordingsDirs: [
              path.join(app.getPath('userData'), 'recordings'),
              path.join(app.getPath('appData'), 'jd-notes-things', 'recordings'),
            ],
            embedSpeakers: (audioPath, segments) => voiceProfileService.embedSpeakers(audioPath, segments),
            upsertProfileSample: (contact, embedding, dur, mid) =>
              voiceProfileService.upsertProfileSample(contact, embedding, dur, mid),
            log: msg => console.log(msg),
            warn: msg => console.warn(msg),
          };
          reembedCorrections(reembedDeps, meeting, reembedTargets, meetingId).catch(err =>
            console.warn('[CorrectionReembed] Unexpected re-embed failure (correction still applied):', err.message)
          );
        }
      }
```

- [ ] **Step 7: Wire the backfill IPC deps for Task 3's new dependencies**

Current (`src/main.js:6977-6979`), the head of the `runBackfill` deps object:
```javascript
          getAllMeetings: () => databaseService.getAllMeetings(),
          countVoiceSamplesForMeeting: id => databaseService.countVoiceSamplesForMeeting(id),
          fileExists: p => fs.existsSync(p),
```
Replace with (drop the now-unused meeting-level count, add the per-identity deps):
```javascript
          getAllMeetings: () => databaseService.getAllMeetings(),
          getSampledProfileIdsForMeeting: id => databaseService.getSampledProfileIdsForMeeting(id),
          getProfileIdByEmail: email => voiceProfileService.getProfileByEmail(email)?.id ?? null,
          fileExists: p => fs.existsSync(p),
```

- [ ] **Step 8: Run the full unit suite**

Run: `npx vitest run`
Expected: 318 baseline + new tests (Task 2 recency, Task 3 revisit, Task 4's 4 correctionReembed) all PASS; no regressions (ignore the environmental `wasapiCapture` EADDRINUSE failure if present).

- [ ] **Step 9: Lint**

Run: `npm run lint`
Expected: zero errors, zero warnings. (Confirms no unused-var warning from the removed `countVoiceSamplesForMeeting` wiring or the new import.)

- [ ] **Step 10: Commit**

```bash
git add src/main/services/correctionReembed.js tests/unit/correctionReembed.test.js src/main.js
git commit -m "feat(voice): F1 re-embed on embedding-less corrections

When a Fix Speakers correction lands on a label with no persisted embedding, the
app now re-embeds the meeting audio for that label (fire-and-forget) so the
correction still teaches the right person's profile. New dependency-injected
correctionReembed module reuses the backfill's segment/audio helpers; cloud-only
meetings and an unreachable audio service are silent skips. Also wires the
backfill IPC to the per-identity skip deps.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---
## Task 5: Full verification + JD manual checklist

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite green**

Run: `npx vitest run`
Expected: all prior passing tests plus the new ones pass. The only acceptable failure is the environmental `wasapiCapture` EADDRINUSE (unrelated to these files); confirm the passing-test count rose by the new tests (recency window, backfill revisit, 4 correctionReembed) over the 318 baseline.

- [ ] **Step 2: Lint clean**

Run: `npm run lint`
Expected: zero errors, zero warnings.

- [ ] **Step 3: Re-inspect the dev DB schema after a dev run (read-only)**

After launching the dev app once (`npm start`) so the v5 migration runs against the dev DB, re-run the read-only inspection script to confirm the migration applied cleanly. Do NOT modify either DB manually.

Run:
```bash
ELECTRON_RUN_AS_NODE=1 npx electron "C:/Users/brigh/AppData/Local/Temp/claude/C--Users-brigh-Documents-code-jd-notes-things/768548fb-d9d2-4621-9b06-87a23fdee162/scratchpad/inspect-voice-schema.js"
```
Expected:
- `user_version` -> 5.
- `PRAGMA index_list(voice_samples)` now includes `idx_voice_samples_profile_meeting` with `unique: 1`.
- The duplicate-check query returns 0 duplicate groups (was 15 before migration).
- `voice_samples` row count dropped by the number of duplicate rows removed (15 groups x 1 extra each = 15 rows; ~309 -> ~294, allowing for any new samples created during the dev run).

- [ ] **Step 4: JD manual checklist (real app, GUI)**

Quit the installed production app first (both write to the same log — see project notes), then run only the dev build (`npm start`, red tray icon). Verify:

1. **F1 correction teaches an embedding-less label.** Open a local-mode meeting where a speaker was track-anchored or left pending (no persisted embedding). Fix that speaker to the correct contact via Fix Speakers. Confirm in the log either `[CorrectionReembed] ... enrolled|strengthened via re-embed of <label> in <meetingId>` (audio present) OR `[CorrectionReembed] No local audio for <meetingId> — skipping (cloud-only meeting)` for a cloud-only meeting — and the correction itself still applies and saves either way (no error toast).
2. **Unreachable service degrades gracefully.** Stop the JD Audio Service, repeat a correction on an embedding-less label with local audio present. Confirm a single `[CorrectionReembed] Re-embed failed ... (correction still applied)` warning and that the correction still saved.
3. **Re-run the backfill (per-identity revisit).** Trigger the voice-profile backfill again. Expect the summary to report additional `samplesAdded` from previously-skipped meetings (meetings whose samples earlier came only from other speakers) and zero constraint errors. Under the old meeting-level skip this run would have added nothing.
4. **Centroid recency.** Confirm the Voice Profiles panel still shows the full sample count for JD's profile (the large-history profile) — confidence/count are unchanged by the window; only the centroid math is bounded.

- [ ] **Step 5: Finalize the branch**

REQUIRED SUB-SKILL: Use superpowers:finishing-a-development-branch to present merge/PR options.

---

## Self-review notes (author)

- **Spec F1 (re-embed + per-identity backfill skip):** Task 4 (re-embed module + main.js hook) and Task 3 (per-identity skip). Covered.
- **Spec section 2 (50-sample recency window):** Task 2 (`MAX_CENTROID_SAMPLES=50`; ordering per real columns — `created_at ASC, id ASC` with `id` tiebreaker because `created_at` is 1s-resolution TEXT). Covered.
- **Spec section 3 (schema v5 unique index + true upsert + dedupe + `getSampledProfileIdsForMeeting`):** Task 1. Covered; the dedupe step is mandatory because 15 real duplicate groups exist today.
- **Ambiguity resolved — recency ordering key:** spec says "ordered by created_at"; real inspection showed `created_at` is second-resolution TEXT, so ordering adds `id ASC` as the monotonic tiebreaker.
- **Ambiguity resolved — F1 testability:** main.js is not unit-testable, so the F1 logic is extracted into `correctionReembed.js` (dependency-injected like `voiceProfileBackfill.js`) and unit-tested there; main.js only wires it fire-and-forget.
- **Ambiguity resolved — NULL meeting_id + unique index:** SQLite treats NULLs as distinct, so anchor/manual samples with `meeting_id = NULL` never collide and the dedupe only targets `meeting_id IS NOT NULL`. Confirmed against the real nullable column.
- **Surprising finding:** the auto-match path (`identifySpeakers`) and the anchor path call `addSample`/`insertVoiceSample` directly with a `meetingId`; after Task 1 those inserts also become upserts, so within a single run two labels matching the same profile+meeting now collapse to one row — consistent with the spec's one-sample-per-profile-per-meeting rule.
- **Type consistency check:** `reembedCorrections(deps, meeting, targets, meetingId)` signature and `{embedded, samplesAdded, samplesRejected, skippedNoAudio, error}` return shape match between Task 4's test (Step 1), module (Step 3), and main.js caller (Step 6). Backfill deps `getSampledProfileIdsForMeeting`/`getProfileIdByEmail` names match between Task 1 (DB method), Task 3 (consumer + tests), and Task 4 Step 7 (IPC wiring). `MAX_CENTROID_SAMPLES` defined (Task 2 Step 3), exported (Step 5), and imported by the test (Step 1).
