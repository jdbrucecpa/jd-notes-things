/**
 * SpeakerMatcher Unit Tests
 *
 * Tests the v1.3 changes:
 * - SDK speech timeline always runs first when available
 * - AssemblyAI identified speakers used as supplementary (no short-circuit)
 * - Heuristics run for any still-unmatched speakers
 * - nameMatchStrict behavior
 */

const { describe, it, expect, beforeEach, vi } = await import('vitest');

// SpeakerMatcher is CommonJS
const SpeakerMatcher = require('../../src/main/integrations/SpeakerMatcher.js');

// --- Test Helpers ---

/**
 * Create a mock GoogleContacts instance with configurable behavior
 */
function createMockContacts(contactsByEmail = {}, contactsByName = {}) {
  return {
    findContactsByEmails: vi.fn(async (emails) => {
      const map = new Map();
      for (const email of emails) {
        if (contactsByEmail[email]) {
          map.set(email, contactsByEmail[email]);
        }
      }
      return map;
    }),
    findContactByName: vi.fn(async (name) => {
      return contactsByName[name] || null;
    }),
  };
}

/**
 * Build a transcript with speaker labels and timestamps
 */
function makeTranscript(entries) {
  return entries.map((e, i) => ({
    speaker: e.speaker,
    text: e.text || `Utterance ${i}`,
    timestamp: e.timestamp ?? i * 5000,
    words: e.words || [{ end: (e.timestamp ?? i * 5000) + 3000 }],
    speakerIdentified: e.speakerIdentified || false,
    speakerName: e.speakerName || undefined,
  }));
}

/**
 * Build an SDK speech timeline with participant speech segments
 */
function makeSpeechTimeline(participants) {
  return {
    participants: participants.map(p => ({
      name: p.name,
      segments: p.segments.map(s => ({ start: s[0], end: s[1] })),
    })),
  };
}

// --- Tests ---

describe('SpeakerMatcher', () => {
  let matcher;
  let mockContacts;

  beforeEach(() => {
    mockContacts = createMockContacts(
      {
        'jenn@example.com': {
          name: 'Jenn Kenning',
          givenName: 'Jenn',
          familyName: 'Kenning',
          emails: ['jenn@example.com'],
          organization: 'Acme Corp',
        },
        'jon@example.com': {
          name: 'Jon D. Jones',
          givenName: 'Jon',
          familyName: 'D. Jones',
          emails: ['jon@example.com'],
          organization: 'Beta Inc',
        },
        'host@example.com': {
          name: 'Meeting Host',
          givenName: 'Meeting',
          familyName: 'Host',
          emails: ['host@example.com'],
        },
      },
      {
        'Jenn Kenning': { email: 'jenn@example.com', emails: ['jenn@example.com'], name: 'Jenn Kenning' },
        'Jon D. Jones': { email: 'jon@example.com', emails: ['jon@example.com'], name: 'Jon D. Jones' },
      }
    );
    matcher = new SpeakerMatcher(mockContacts);
  });

  // ─────────────────────────────────────────────────────────────────
  // nameMatchStrict
  // ─────────────────────────────────────────────────────────────────

  describe('nameMatchStrict', () => {
    it('matches identical names', () => {
      expect(matcher.nameMatchStrict('Jenn Kenning', 'Jenn Kenning')).toBe(true);
    });

    it('matches case-insensitively', () => {
      expect(matcher.nameMatchStrict('jenn kenning', 'Jenn Kenning')).toBe(true);
    });

    it('matches multi-word substring (both have 2+ words)', () => {
      expect(matcher.nameMatchStrict('JD Bruce', 'JD Bruce Smith')).toBe(true);
    });

    it('rejects single-word substring match to prevent false positives', () => {
      // "Ed" should NOT match "Fred"
      expect(matcher.nameMatchStrict('Ed', 'Fred')).toBe(false);
    });

    it('rejects single-word to multi-word partial match', () => {
      // "Jenn" alone should NOT match "Jenn Kenning" via substring
      // (single word can only match by exact)
      expect(matcher.nameMatchStrict('Jenn', 'Jenn Kenning')).toBe(false);
    });

    it('returns false for null/undefined inputs', () => {
      expect(matcher.nameMatchStrict(null, 'Name')).toBe(false);
      expect(matcher.nameMatchStrict('Name', undefined)).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // matchSpeakers — SDK timeline priority (v1.3 core change)
  // ─────────────────────────────────────────────────────────────────

  describe('matchSpeakers — SDK timeline priority', () => {
    it('uses SDK timeline first even when AssemblyAI speakers are identified', async () => {
      // Transcript has speakerIdentified=true (AssemblyAI provided names)
      // BUT we also have an SDK speech timeline
      // v1.3: timeline should run first, not be short-circuited
      const transcript = makeTranscript([
        { speaker: 'Jenn', text: 'Hello everyone', timestamp: 1000, speakerIdentified: true },
        { speaker: 'Jenn', text: 'Welcome to the meeting', timestamp: 6000, speakerIdentified: true },
        { speaker: 'Jenn', text: 'Lets get started', timestamp: 11000, speakerIdentified: true },
        { speaker: 'Jon Jones', text: 'Thanks Jenn', timestamp: 16000, speakerIdentified: true },
        { speaker: 'Jon Jones', text: 'I have updates', timestamp: 21000, speakerIdentified: true },
        { speaker: 'Jon Jones', text: 'Heres my report', timestamp: 26000, speakerIdentified: true },
      ]);

      // SDK knows the REAL full names
      const speechTimeline = makeSpeechTimeline([
        { name: 'Jenn Kenning', segments: [[0, 14000]] },
        { name: 'Jon D. Jones', segments: [[15000, 30000]] },
      ]);

      const participantEmails = ['jenn@example.com', 'jon@example.com'];

      const result = await matcher.matchSpeakers(transcript, participantEmails, {
        speechTimeline,
        participantData: [
          { name: 'Jenn Kenning', originalName: 'Jenn Kenning', email: 'jenn@example.com' },
          { name: 'Jon D. Jones', originalName: 'Jon D. Jones', email: 'jon@example.com' },
        ],
      });

      // Timeline should have matched speakers using full SDK names
      expect(result['Jenn']).toBeDefined();
      expect(result['Jenn'].name).toBe('Jenn Kenning'); // Full name from SDK, not truncated "Jenn"
      expect(result['Jenn'].method).toBe('speech-timeline');

      expect(result['Jon Jones']).toBeDefined();
      expect(result['Jon Jones'].name).toBe('Jon D. Jones'); // Full name from SDK
      expect(result['Jon Jones'].method).toBe('speech-timeline');
    });

    it('falls back to AssemblyAI names when no SDK timeline available', async () => {
      const transcript = makeTranscript([
        { speaker: 'Jenn Kenning', text: 'Hello', timestamp: 1000, speakerIdentified: true },
        { speaker: 'Jon Jones', text: 'Hi', timestamp: 5000, speakerIdentified: true },
      ]);

      const participantEmails = ['jenn@example.com', 'jon@example.com'];

      const result = await matcher.matchSpeakers(transcript, participantEmails, {
        speechTimeline: null, // No SDK timeline
        participantData: [
          { name: 'Jenn Kenning', originalName: 'Jenn Kenning', email: 'jenn@example.com' },
          { name: 'Jon D. Jones', originalName: 'Jon D. Jones', email: 'jon@example.com' },
        ],
      });

      // Should use AssemblyAI identified speakers path
      expect(result['Jenn Kenning']).toBeDefined();
      expect(result['Jenn Kenning'].method).toBe('assemblyai-speaker-identification');
    });

    it('uses AssemblyAI names as supplementary for timeline-unmatched speakers', async () => {
      // Timeline only matches Speaker A, not Speaker B
      const transcript = makeTranscript([
        { speaker: 'Speaker A', text: 'Hello', timestamp: 1000, speakerIdentified: false },
        { speaker: 'Speaker A', text: 'More talk', timestamp: 6000, speakerIdentified: false },
        { speaker: 'Speaker A', text: 'Still talking', timestamp: 11000, speakerIdentified: false },
        // Speaker B has identified name from AssemblyAI but no timeline overlap
        { speaker: 'Jon Jones', text: 'My turn', timestamp: 50000, speakerIdentified: true },
        { speaker: 'Jon Jones', text: 'I have updates', timestamp: 55000, speakerIdentified: true },
      ]);

      const speechTimeline = makeSpeechTimeline([
        { name: 'Jenn Kenning', segments: [[0, 14000]] },
        // Jon's segments don't overlap with any transcript entries
        { name: 'Jon D. Jones', segments: [[100000, 110000]] },
      ]);

      const participantEmails = ['jenn@example.com', 'jon@example.com'];

      const result = await matcher.matchSpeakers(transcript, participantEmails, {
        speechTimeline,
        participantData: [
          { name: 'Jenn Kenning', originalName: 'Jenn Kenning', email: 'jenn@example.com' },
          { name: 'Jon D. Jones', originalName: 'Jon D. Jones', email: 'jon@example.com' },
        ],
      });

      // Speaker A matched by timeline
      expect(result['Speaker A']).toBeDefined();
      expect(result['Speaker A'].name).toBe('Jenn Kenning');
      expect(result['Speaker A'].method).toBe('speech-timeline');

      // Jon Jones matched by AssemblyAI supplementary (since timeline couldn't match)
      expect(result['Jon Jones']).toBeDefined();
      expect(result['Jon Jones'].method).toBe('assemblyai-speaker-identification');
    });

    it('uses heuristics for speakers unmatched by both timeline and AssemblyAI', async () => {
      // Generic speaker labels, no AssemblyAI identification, no timeline overlap for Speaker B
      const transcript = makeTranscript([
        { speaker: 'Speaker A', text: 'Hello', timestamp: 1000 },
        { speaker: 'Speaker A', text: 'More talk', timestamp: 6000 },
        { speaker: 'Speaker A', text: 'Still going', timestamp: 11000 },
        { speaker: 'Speaker B', text: 'My turn', timestamp: 50000 },
      ]);

      const speechTimeline = makeSpeechTimeline([
        { name: 'Jenn Kenning', segments: [[0, 14000]] },
        // No segments matching Speaker B's timestamps
      ]);

      const participantEmails = ['jenn@example.com', 'jon@example.com'];

      const result = await matcher.matchSpeakers(transcript, participantEmails, {
        speechTimeline,
        participantData: [
          { name: 'Jenn Kenning', originalName: 'Jenn Kenning', email: 'jenn@example.com', isHost: true },
          { name: 'Jon D. Jones', originalName: 'Jon D. Jones', email: 'jon@example.com' },
        ],
      });

      // Speaker A matched by timeline
      expect(result['Speaker A']).toBeDefined();
      expect(result['Speaker A'].name).toBe('Jenn Kenning');
      expect(result['Speaker A'].method).toBe('speech-timeline');

      // Speaker B should be matched by heuristics (not left empty)
      expect(result['Speaker B']).toBeDefined();
      expect(result['Speaker B'].method).not.toBe('speech-timeline');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // matchSpeakers — no short-circuit (v1.3 regression guard)
  // ─────────────────────────────────────────────────────────────────

  describe('matchSpeakers — no AssemblyAI short-circuit', () => {
    it('does NOT skip SDK timeline when AssemblyAI speakers are identified', async () => {
      // This is the KEY regression test: pre-v1.3 code would short-circuit
      // and never call matchUsingTimeline when speakerIdentified was true

      const timelineSpy = vi.spyOn(matcher, 'matchUsingTimeline');
      vi.spyOn(matcher, 'buildMappingFromIdentifiedSpeakers');

      const transcript = makeTranscript([
        { speaker: 'Jenn', text: 'Hello', timestamp: 1000, speakerIdentified: true },
        { speaker: 'Jenn', text: 'More', timestamp: 6000, speakerIdentified: true },
        { speaker: 'Jenn', text: 'Still more', timestamp: 11000, speakerIdentified: true },
      ]);

      const speechTimeline = makeSpeechTimeline([
        { name: 'Jenn Kenning', segments: [[0, 14000]] },
      ]);

      await matcher.matchSpeakers(transcript, ['jenn@example.com'], {
        speechTimeline,
        participantData: [
          { name: 'Jenn Kenning', originalName: 'Jenn Kenning', email: 'jenn@example.com' },
        ],
      });

      // Timeline MUST be called (v1.3 fix: no more short-circuit)
      expect(timelineSpy).toHaveBeenCalled();
    });

    it('still calls buildMappingFromIdentifiedSpeakers for unmatched speakers', async () => {
      const identifiedSpy = vi.spyOn(matcher, 'buildMappingFromIdentifiedSpeakers');

      // Two speakers but timeline only matches one
      const transcript = makeTranscript([
        { speaker: 'Speaker A', text: 'Hello', timestamp: 1000 },
        { speaker: 'Speaker A', text: 'More talk', timestamp: 6000 },
        { speaker: 'Speaker A', text: 'Still going', timestamp: 11000 },
        { speaker: 'Jon Jones', text: 'My turn', timestamp: 50000, speakerIdentified: true },
      ]);

      const speechTimeline = makeSpeechTimeline([
        { name: 'Jenn Kenning', segments: [[0, 14000]] },
      ]);

      await matcher.matchSpeakers(transcript, ['jenn@example.com', 'jon@example.com'], {
        speechTimeline,
        participantData: [
          { name: 'Jenn Kenning', originalName: 'Jenn Kenning', email: 'jenn@example.com' },
          { name: 'Jon D. Jones', originalName: 'Jon D. Jones', email: 'jon@example.com' },
        ],
      });

      // buildMappingFromIdentifiedSpeakers should be called for the unmatched speaker
      expect(identifiedSpy).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // matchSpeakers — edge cases
  // ─────────────────────────────────────────────────────────────────

  describe('matchSpeakers — edge cases', () => {
    it('returns empty mapping for empty transcript', async () => {
      const result = await matcher.matchSpeakers([], ['jenn@example.com']);
      expect(result).toEqual({});
    });

    it('returns empty mapping for no participants', async () => {
      const transcript = makeTranscript([
        { speaker: 'Speaker A', text: 'Hello', timestamp: 1000 },
      ]);
      const result = await matcher.matchSpeakers(transcript, []);
      expect(result).toEqual({});
    });

    it('handles speech timeline with empty participants array', async () => {
      const transcript = makeTranscript([
        { speaker: 'Speaker A', text: 'Hello', timestamp: 1000 },
      ]);

      const speechTimeline = { participants: [] };

      const result = await matcher.matchSpeakers(transcript, ['jenn@example.com'], {
        speechTimeline,
        participantData: [
          { name: 'Jenn Kenning', originalName: 'Jenn Kenning', email: 'jenn@example.com', isHost: true },
        ],
      });

      // Should fall through to heuristics since timeline has no participants
      expect(result['Speaker A']).toBeDefined();
    });

    it('handles null speech timeline gracefully', async () => {
      const transcript = makeTranscript([
        { speaker: 'Speaker A', text: 'Hello', timestamp: 1000 },
      ]);

      const result = await matcher.matchSpeakers(transcript, ['jenn@example.com'], {
        speechTimeline: null,
        participantData: [
          { name: 'Jenn Kenning', originalName: 'Jenn Kenning', email: 'jenn@example.com', isHost: true },
        ],
      });

      expect(result['Speaker A']).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // matchUsingTimeline — timestamp correlation
  // ─────────────────────────────────────────────────────────────────

  describe('matchUsingTimeline', () => {
    it('correlates transcript timestamps to SDK speech segments', () => {
      const transcript = makeTranscript([
        { speaker: 'Speaker A', text: 'Hello from A', timestamp: 2000, words: [{ end: 4000 }] },
        { speaker: 'Speaker A', text: 'More from A', timestamp: 7000, words: [{ end: 9000 }] },
        { speaker: 'Speaker A', text: 'Still A', timestamp: 12000, words: [{ end: 14000 }] },
        { speaker: 'Speaker B', text: 'Hello from B', timestamp: 20000, words: [{ end: 22000 }] },
        { speaker: 'Speaker B', text: 'More from B', timestamp: 25000, words: [{ end: 27000 }] },
      ]);

      const speechTimeline = makeSpeechTimeline([
        { name: 'Jenn Kenning', segments: [[0, 15000]] },
        { name: 'Jon D. Jones', segments: [[18000, 30000]] },
      ]);

      const contacts = new Map([
        ['jenn@example.com', { name: 'Jenn Kenning' }],
        ['jon@example.com', { name: 'Jon D. Jones' }],
      ]);

      const result = matcher.matchUsingTimeline(
        transcript,
        speechTimeline,
        ['jenn@example.com', 'jon@example.com'],
        contacts
      );

      expect(result['Speaker A']).toBeDefined();
      expect(result['Speaker A'].name).toBe('Jenn Kenning');
      expect(result['Speaker A'].method).toBe('speech-timeline');

      expect(result['Speaker B']).toBeDefined();
      expect(result['Speaker B'].name).toBe('Jon D. Jones');
      expect(result['Speaker B'].method).toBe('speech-timeline');
    });

    it('requires at least 2 matches for confidence', () => {
      // Only 1 utterance matches — should NOT be assigned
      const transcript = makeTranscript([
        { speaker: 'Speaker A', text: 'Hello', timestamp: 2000, words: [{ end: 4000 }] },
      ]);

      const speechTimeline = makeSpeechTimeline([
        { name: 'Jenn Kenning', segments: [[0, 5000]] },
      ]);

      const contacts = new Map([
        ['jenn@example.com', { name: 'Jenn Kenning' }],
      ]);

      const result = matcher.matchUsingTimeline(
        transcript,
        speechTimeline,
        ['jenn@example.com'],
        contacts
      );

      // Only 1 match — not enough for confidence
      expect(result['Speaker A']).toBeUndefined();
    });

    it('uses 2-second tolerance window for timestamp matching', () => {
      // Utterance starts 1.5 seconds before segment — within 2s tolerance
      const transcript = makeTranscript([
        { speaker: 'Speaker A', text: 'Hello', timestamp: 8500, words: [{ end: 10000 }] },
        { speaker: 'Speaker A', text: 'More', timestamp: 11000, words: [{ end: 13000 }] },
        { speaker: 'Speaker A', text: 'Still', timestamp: 14000, words: [{ end: 16000 }] },
      ]);

      const speechTimeline = makeSpeechTimeline([
        { name: 'Jenn Kenning', segments: [[10000, 20000]] },
      ]);

      const contacts = new Map([
        ['jenn@example.com', { name: 'Jenn Kenning' }],
      ]);

      const result = matcher.matchUsingTimeline(
        transcript,
        speechTimeline,
        ['jenn@example.com'],
        contacts
      );

      // Should match because 8500 is within tolerance of segment starting at 10000
      expect(result['Speaker A']).toBeDefined();
      expect(result['Speaker A'].name).toBe('Jenn Kenning');
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // buildMappingFromIdentifiedSpeakers
  // ─────────────────────────────────────────────────────────────────

  describe('buildMappingFromIdentifiedSpeakers', () => {
    it('builds mapping from AssemblyAI identified speaker names', async () => {
      const transcript = makeTranscript([
        { speaker: 'Jenn Kenning', text: 'Hello', timestamp: 1000, speakerIdentified: true },
        { speaker: 'Jon D. Jones', text: 'Hi', timestamp: 5000, speakerIdentified: true },
      ]);

      const result = await matcher.buildMappingFromIdentifiedSpeakers(
        transcript,
        ['jenn@example.com', 'jon@example.com'],
        {
          participantData: [
            { name: 'Jenn Kenning', originalName: 'Jenn Kenning', email: 'jenn@example.com' },
            { name: 'Jon D. Jones', originalName: 'Jon D. Jones', email: 'jon@example.com' },
          ],
        }
      );

      expect(result['Jenn Kenning']).toBeDefined();
      expect(result['Jenn Kenning'].email).toBe('jenn@example.com');
      expect(result['Jenn Kenning'].method).toBe('assemblyai-speaker-identification');

      expect(result['Jon D. Jones']).toBeDefined();
      expect(result['Jon D. Jones'].email).toBe('jon@example.com');
    });

    it('matches truncated AssemblyAI names to full participant names', async () => {
      const transcript = makeTranscript([
        { speaker: 'Jenn Kenning', text: 'Hello', timestamp: 1000, speakerIdentified: true },
      ]);

      const result = await matcher.buildMappingFromIdentifiedSpeakers(
        transcript,
        ['jenn@example.com'],
        {
          participantData: [
            { name: 'Jenn Kenning', originalName: 'Jenn Kenning', email: 'jenn@example.com' },
          ],
        }
      );

      // Should use participant's originalName, not truncated AssemblyAI name
      expect(result['Jenn Kenning'].name).toBe('Jenn Kenning');
    });

    it('ignores non-identified entries', async () => {
      const transcript = makeTranscript([
        { speaker: 'Speaker A', text: 'Hello', timestamp: 1000, speakerIdentified: false },
        { speaker: 'Jenn Kenning', text: 'Hi', timestamp: 5000, speakerIdentified: true },
      ]);

      const result = await matcher.buildMappingFromIdentifiedSpeakers(
        transcript,
        ['jenn@example.com'],
        { participantData: [{ name: 'Jenn Kenning', originalName: 'Jenn Kenning', email: 'jenn@example.com' }] }
      );

      expect(result['Speaker A']).toBeUndefined(); // Not identified
      expect(result['Jenn Kenning']).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // applyMappingToTranscript
  // ─────────────────────────────────────────────────────────────────

  describe('applyMappingToTranscript', () => {
    it('adds speakerName to transcript entries based on mapping', () => {
      const transcript = [
        { speaker: 'Speaker A', text: 'Hello' },
        { speaker: 'Speaker B', text: 'Hi there' },
      ];

      const mapping = {
        'Speaker A': { name: 'Jenn Kenning', email: 'jenn@example.com', confidence: 'high' },
        'Speaker B': { name: 'Jon D. Jones', email: 'jon@example.com', confidence: 'medium' },
      };

      const result = matcher.applyMappingToTranscript(transcript, mapping);

      expect(result[0].speakerName).toBe('Jenn Kenning');
      expect(result[0].speakerEmail).toBe('jenn@example.com');
      expect(result[0].speaker).toBe('Speaker A'); // Original label preserved
      expect(result[1].speakerName).toBe('Jon D. Jones');
    });

    it('preserves unmapped entries unchanged', () => {
      const transcript = [
        { speaker: 'Speaker C', text: 'Hello' },
      ];

      const mapping = {
        'Speaker A': { name: 'Jenn Kenning', email: 'jenn@example.com', confidence: 'high' },
      };

      const result = matcher.applyMappingToTranscript(transcript, mapping);
      expect(result[0].speakerName).toBeUndefined();
      expect(result[0].speaker).toBe('Speaker C');
    });
  });
});
