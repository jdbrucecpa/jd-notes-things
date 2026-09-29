/**
 * meetingSnapshot — field-level read-modify-write for the meetings store.
 *
 * Regression context (2026-09-29): a post-recording pipeline read a snapshot of
 * ALL meetings, awaited speaker matching for ~10s, then wrote the whole
 * snapshot back. A meeting whose recording had just started in that window was
 * reverted to its pre-start row (recordingId, transcriptionProvider and
 * recordingAction all lost), so its recording could never be transcribed.
 */
const {
  captureBaseline,
  diffAgainstBaseline,
  applyPatchToMeeting,
  createMeetingStore,
} = require('../../src/main/services/meetingSnapshot');

const clone = v => JSON.parse(JSON.stringify(v));

/**
 * In-memory stand-in for databaseService with the same patch semantics as
 * databaseService.applyMeetingPatches (rows keyed by id with a status).
 */
function createFakeDb(initial = {}) {
  const rows = new Map(); // id → { status, meeting }
  for (const [status, list] of [
    ['upcoming', initial.upcomingMeetings || []],
    ['past', initial.pastMeetings || []],
  ]) {
    for (const m of list) rows.set(m.id, { status, meeting: clone(m) });
  }
  return {
    rows,
    getAllMeetings() {
      const out = { upcomingMeetings: [], pastMeetings: [] };
      for (const { status, meeting } of rows.values()) {
        (status === 'upcoming' ? out.upcomingMeetings : out.pastMeetings).push(clone(meeting));
      }
      return out;
    },
    applyMeetingPatches(patches) {
      for (const p of patches) {
        const row = rows.get(p.id);
        if (!row) {
          if (p.insert) rows.set(p.id, { status: p.status || 'past', meeting: clone(p.insert) });
          continue;
        }
        const merged = p.insert
          ? { ...row.meeting, ...clone(p.insert) }
          : applyPatchToMeeting(row.meeting, clone(p));
        rows.set(p.id, { status: p.status || row.status, meeting: merged });
      }
    },
  };
}

describe('diffAgainstBaseline', () => {
  it('reports no patches when nothing changed', () => {
    const data = { upcomingMeetings: [], pastMeetings: [{ id: 'a', title: 'A', transcript: [] }] };
    const base = captureBaseline(data);
    expect(diffAgainstBaseline(base, data)).toEqual([]);
  });

  it('reports only the fields that changed, including nested in-place mutation', () => {
    const data = {
      upcomingMeetings: [],
      pastMeetings: [{ id: 'a', title: 'A', transcript: [{ speaker: 'S0', text: 'hi' }] }],
    };
    const base = captureBaseline(data);
    data.pastMeetings[0].transcript[0].speaker = 'S1'; // in-place, same array reference
    const patches = diffAgainstBaseline(base, data);
    expect(patches).toEqual([
      { id: 'a', set: { transcript: [{ speaker: 'S1', text: 'hi' }] }, unset: [], status: null },
    ]);
  });

  it('turns a deleted key into an unset', () => {
    const data = { upcomingMeetings: [], pastMeetings: [{ id: 'a', title: 'A', recordingAction: 'new' }] };
    const base = captureBaseline(data);
    delete data.pastMeetings[0].recordingAction;
    expect(diffAgainstBaseline(base, data)).toEqual([
      { id: 'a', set: {}, unset: ['recordingAction'], status: null },
    ]);
  });

  it('marks meetings absent from the baseline as inserts', () => {
    const data = { upcomingMeetings: [], pastMeetings: [] };
    const base = captureBaseline(data);
    data.pastMeetings.unshift({ id: 'new', title: 'New' });
    expect(diffAgainstBaseline(base, data)).toEqual([
      { id: 'new', insert: { id: 'new', title: 'New' }, status: 'past' },
    ]);
  });

  it('reports a status change when a meeting moves from upcoming to past', () => {
    const data = { upcomingMeetings: [{ id: 'a', title: 'A' }], pastMeetings: [] };
    const base = captureBaseline(data);
    data.pastMeetings.unshift(data.upcomingMeetings.splice(0, 1)[0]);
    expect(diffAgainstBaseline(base, data)).toEqual([
      { id: 'a', set: {}, unset: [], status: 'past' },
    ]);
  });
});

describe('createMeetingStore', () => {
  it('a stale snapshot write does not revert a meeting it never touched (2026-09-29 regression)', () => {
    const db = createFakeDb({
      pastMeetings: [{ id: 'chris', title: 'Chris', transcript: [] }],
    });
    const store = createMeetingStore(() => db);

    // Renderer creates the Jake note (no recording yet).
    db.applyMeetingPatches([{ id: 'jake', insert: { id: 'jake', title: 'Jake' }, status: 'past' }]);

    // Chris pipeline takes its snapshot while Jake is still unlinked...
    const pipelineSnapshot = store.read();

    // ...start-recording links Jake to its recording...
    const startSnapshot = store.read();
    const jake = startSnapshot.pastMeetings.find(m => m.id === 'jake');
    jake.recordingId = 'C:/rec/recording-1.mp3';
    jake.transcriptionProvider = 'local';
    jake.recordingAction = 'new';
    store.write(startSnapshot);

    // ...then the pipeline finishes speaker matching and writes its snapshot back.
    const chris = pipelineSnapshot.pastMeetings.find(m => m.id === 'chris');
    chris.transcript = [{ speaker: 'JD', text: 'hello' }];
    store.write(pipelineSnapshot);

    const final = db.getAllMeetings().pastMeetings;
    expect(final.find(m => m.id === 'jake')).toMatchObject({
      recordingId: 'C:/rec/recording-1.mp3',
      transcriptionProvider: 'local',
      recordingAction: 'new',
    });
    expect(final.find(m => m.id === 'chris').transcript).toEqual([{ speaker: 'JD', text: 'hello' }]);
  });

  it('merges concurrent edits to different fields of the same meeting', () => {
    const db = createFakeDb({ pastMeetings: [{ id: 'a', title: 'Old', content: 'x' }] });
    const store = createMeetingStore(() => db);

    const s1 = store.read();
    const s2 = store.read();
    s1.pastMeetings[0].title = 'New title';
    s2.pastMeetings[0].content = 'summary';
    store.write(s1);
    store.write(s2);

    expect(db.getAllMeetings().pastMeetings[0]).toMatchObject({ title: 'New title', content: 'summary' });
  });

  it('a second write from the same snapshot only sends fields changed since the first write', () => {
    const db = createFakeDb({ pastMeetings: [{ id: 'a', title: 'T', transcript: [] }] });
    const store = createMeetingStore(() => db);

    const mine = store.read();
    mine.pastMeetings[0].transcript = [{ speaker: 'S0', text: 'one' }];
    store.write(mine);

    // Someone else renames the meeting in between.
    const other = store.read();
    other.pastMeetings[0].title = 'Renamed';
    store.write(other);

    // My second write changes speakerMapping only — it must not re-assert the old title.
    mine.pastMeetings[0].speakerMapping = { S0: { name: 'JD' } };
    store.write(mine);

    expect(db.getAllMeetings().pastMeetings[0]).toMatchObject({
      title: 'Renamed',
      transcript: [{ speaker: 'S0', text: 'one' }],
      speakerMapping: { S0: { name: 'JD' } },
    });
  });

  it('update() diffs whatever object the operation returns against the fresh read', async () => {
    const db = createFakeDb({
      pastMeetings: [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
      ],
    });
    const store = createMeetingStore(() => db);

    await store.update(async current => ({
      upcomingMeetings: current.upcomingMeetings,
      pastMeetings: current.pastMeetings.map(m => (m.id === 'a' ? { ...m, title: 'A2' } : m)),
    }));

    const titles = db.getAllMeetings().pastMeetings.map(m => m.title).sort();
    expect(titles).toEqual(['A2', 'B']);
  });

  it('does not resurrect a meeting deleted while a writer held a snapshot', () => {
    const db = createFakeDb({ pastMeetings: [{ id: 'gone', title: 'G' }] });
    const store = createMeetingStore(() => db);

    const snap = store.read();
    db.rows.delete('gone'); // user deleted it
    snap.pastMeetings[0].title = 'edited';
    store.write(snap);

    expect(db.rows.has('gone')).toBe(false);
  });

  it('falls back to a full write for data that was not produced by read()', () => {
    const db = createFakeDb({ pastMeetings: [{ id: 'a', title: 'A', content: 'keep' }] });
    const store = createMeetingStore(() => db);

    store.write({ upcomingMeetings: [], pastMeetings: [{ id: 'n', title: 'N' }] });

    const ids = db.getAllMeetings().pastMeetings.map(m => m.id).sort();
    expect(ids).toEqual(['a', 'n']);
    expect(db.getAllMeetings().pastMeetings.find(m => m.id === 'a').content).toBe('keep');
  });
});
