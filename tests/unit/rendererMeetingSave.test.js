/**
 * rendererMeetingSave — turns a renderer saveMeetingsData call into targeted
 * patches. The renderer holds a possibly-stale copy of every meeting; a save
 * must only touch the meeting(s) the renderer actually edited.
 */
const { buildRendererSavePatches } = require('../../src/main/services/rendererMeetingSave');

const current = {
  upcomingMeetings: [],
  pastMeetings: [
    {
      id: 'processing',
      title: 'Chris',
      transcript: [{ speaker: 'JD', text: 'fresh' }],
      micAudioFilePath: 'C:/rec/a-mic.mp3',
    },
    { id: 'editing', title: 'Jake', content: 'old', recordingId: 'C:/rec/b.mp3' },
  ],
};

// Renderer copy loaded before either meeting was updated by the main process.
const renderer = {
  upcomingMeetings: [],
  pastMeetings: [
    { id: 'processing', title: 'Chris', transcript: [] },
    { id: 'editing', title: 'Jake — edited', content: 'new notes' },
  ],
};

describe('buildRendererSavePatches', () => {
  it('with meetingIds + fields, patches only those fields of those meetings', () => {
    const patches = buildRendererSavePatches(renderer, current, {
      meetingIds: ['editing'],
      fields: ['title', 'content'],
    });
    expect(patches).toEqual([
      { id: 'editing', set: { title: 'Jake — edited', content: 'new notes' }, unset: [], status: null },
    ]);
  });

  it('with meetingIds only, merges the whole renderer meeting but keeps main-managed and renderer-unknown fields', () => {
    const patches = buildRendererSavePatches(renderer, current, { meetingIds: ['editing'] });
    expect(patches).toHaveLength(1);
    const { set, unset, status } = patches[0];
    expect(set).toMatchObject({ title: 'Jake — edited', content: 'new notes', recordingId: 'C:/rec/b.mp3' });
    expect(unset).toEqual([]);
    expect(status).toBeNull();
  });

  it('never unsets fields the renderer copy lacks (e.g. isolation-track paths)', () => {
    const patches = buildRendererSavePatches(renderer, current, { meetingIds: ['processing'] });
    expect(patches[0].unset).toEqual([]);
    expect(patches[0].set).not.toHaveProperty('micAudioFilePath');
  });

  it('inserts a meeting the database does not have yet', () => {
    const withNew = {
      upcomingMeetings: [],
      pastMeetings: [{ id: 'brand-new', title: 'New', type: 'document' }],
    };
    expect(buildRendererSavePatches(withNew, current, { meetingIds: ['brand-new'] })).toEqual([
      { id: 'brand-new', insert: { id: 'brand-new', title: 'New', type: 'document' }, status: 'past' },
    ]);
  });

  it('legacy call without options still covers every meeting, without unsets or status moves', () => {
    const patches = buildRendererSavePatches(renderer, current);
    expect(patches.map(p => p.id).sort()).toEqual(['editing', 'processing']);
    for (const p of patches) {
      expect(p.unset).toEqual([]);
      expect(p.status).toBeNull();
    }
  });
});
