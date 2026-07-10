import { describe, it, expect, vi } from 'vitest';
import {
  computeMainParticipant, composeTitle, applyReassignments,
  parseContentPassResponse, buildContentPassPrompts, runContentAwarePass,
} from '../../src/main/services/contentAwarePass.js';

const U = (speaker, name, email, words) => ({
  speaker, speakerName: name, speakerEmail: email, text: 'w '.repeat(words).trim(), timestamp: 0,
});

describe('computeMainParticipant', () => {
  it('picks the most-talkative NON-user speaker by word count', () => {
    const t = [
      U('S0', 'JD Bruce', 'jd@x.com', 500),
      U('S1', 'Kurt Anderson', 'kurt@x.com', 300),
      U('S2', 'Melissa H', 'melissa@x.com', 100),
    ];
    expect(computeMainParticipant(t, { email: 'jd@x.com', name: 'JD Bruce' }))
      .toEqual({ name: 'Kurt Anderson', email: 'kurt@x.com' });
  });
  it('returns null when only the user (or nobody named) spoke', () => {
    expect(computeMainParticipant([U('S0', 'JD Bruce', 'jd@x.com', 50)], { email: 'jd@x.com', name: 'JD Bruce' })).toBeNull();
    expect(computeMainParticipant([{ speaker: 'S0', text: 'hi', timestamp: 0 }], { email: 'jd@x.com', name: 'JD' })).toBeNull();
  });
});

describe('composeTitle', () => {
  it('formats Company - Name - Topic, omitting missing company', () => {
    expect(composeTitle('Paradigm Advisors', 'Monica Fair', 'capacity planning roadmap'))
      .toBe('Paradigm Advisors - Monica Fair - Capacity Planning Roadmap');
    expect(composeTitle(null, 'Kurt Anderson', 'trust fund next steps'))
      .toBe('Kurt Anderson - Trust Fund Next Steps');
    expect(composeTitle(null, null, 'anything')).toBeNull();
  });
});

describe('applyReassignments (permission rules in code)', () => {
  const roster = [{ name: 'Kurt Anderson', email: 'kurt@x.com' }, { name: 'JD Bruce', email: 'jd@x.com' }];
  const mapping = {
    S0: { name: 'JD Bruce', email: 'jd@x.com', confidence: 'high', method: 'track-anchor' },
    S1: { name: 'JD Bruce', email: 'jd@x.com', confidence: 'low', method: 'unverified-positional' },
    S2: { name: 'Kurt Anderson', email: 'kurt@x.com', confidence: 'manual', method: 'user-correction' },
  };
  it('reassigns only low/none labels, resolves via roster, tags content-llm', () => {
    const { updated, changed } = applyReassignments(mapping, [
      { label: 'S0', name: 'Kurt Anderson' },
      { label: 'S1', name: 'Kurt Anderson' },
      { label: 'S2', name: 'JD Bruce' },
      { label: 'S9', name: 'Kurt Anderson' },
      { label: 'S1', name: 'Somebody Invented' },
    ], roster);
    expect(changed).toEqual(['S1']);
    expect(updated.S0.name).toBe('JD Bruce');
    expect(updated.S1).toMatchObject({ name: 'Kurt Anderson', email: 'kurt@x.com', method: 'content-llm', confidence: 'medium' });
    expect(updated.S2.name).toBe('Kurt Anderson');
    expect(mapping.S1.name).toBe('JD Bruce'); // input not mutated
  });
});

describe('parseContentPassResponse', () => {
  it('extracts the JSON object even with surrounding prose/fences', () => {
    const out = parseContentPassResponse('Sure!\n```json\n{"reassignments":[{"label":"S1","name":"Kurt Anderson"}],"topic":"trust fund planning"}\n```');
    expect(out).toEqual({ reassignments: [{ label: 'S1', name: 'Kurt Anderson' }], topic: 'trust fund planning' });
  });
  it('returns null on malformed output', () => {
    expect(parseContentPassResponse('no json here')).toBeNull();
    expect(parseContentPassResponse('{"broken": ')).toBeNull();
  });
});

describe('buildContentPassPrompts', () => {
  it('embeds roster names and current assignment confidence/method in the prompt', () => {
    const roster = [{ name: 'Kurt Anderson', email: 'kurt@x.com', organization: 'Anderson LLC' }];
    const mapping = { S1: { name: 'Kurt Anderson', confidence: 'low', method: 'unverified-positional' } };
    const { systemPrompt, userPrompt } = buildContentPassPrompts(mapping, roster);
    expect(userPrompt).toContain('Kurt Anderson (Anderson LLC) <kurt@x.com>');
    expect(userPrompt).toContain('S1: Kurt Anderson [confidence=low, method=unverified-positional]');
    expect(systemPrompt).toContain('JSON');
  });
});

describe('runContentAwarePass', () => {
  const transcript = [U('S0', 'JD Bruce', 'jd@x.com', 100), U('S1', 'Kurt Anderson', 'kurt@x.com', 300)];
  const mapping = { S1: { name: 'Kurt Anderson', email: 'kurt@x.com', confidence: 'low', method: 'unverified-positional' } };
  const roster = [{ name: 'JD Bruce', email: 'jd@x.com' }, { name: 'Kurt Anderson', email: 'kurt@x.com', organization: 'Anderson LLC' }];

  it('returns reassignments + composed title from one LLM call', async () => {
    const deps = {
      generateCompletion: vi.fn().mockResolvedValue({ content: '{"reassignments":[],"topic":"trust fund next steps"}' }),
      log: () => {},
    };
    const r = await runContentAwarePass(deps, {
      transcript, speakerMapping: mapping, roster,
      user: { name: 'JD Bruce', email: 'jd@x.com' }, cacheableContext: 'CTX',
    });
    expect(deps.generateCompletion).toHaveBeenCalledOnce();
    expect(deps.generateCompletion.mock.calls[0][0].cacheableContext).toBe('CTX');
    expect(r.title).toBe('Anderson LLC - Kurt Anderson - Trust Fund Next Steps');
    expect(r.changed).toEqual([]);
  });

  it('degrades to title-less, change-less result on LLM failure', async () => {
    const deps = { generateCompletion: vi.fn().mockRejectedValue(new Error('boom')), log: () => {} };
    const r = await runContentAwarePass(deps, {
      transcript, speakerMapping: mapping, roster, user: { name: 'JD Bruce', email: 'jd@x.com' }, cacheableContext: 'CTX',
    });
    expect(r).toEqual({ updatedMapping: mapping, changed: [], title: null });
  });
});
