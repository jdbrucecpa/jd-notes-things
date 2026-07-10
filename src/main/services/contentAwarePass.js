// Stage 3 of the speaker waterfall (spec §5): review low-confidence speaker
// assignments against roster + content, and name the meeting. ONE LLM call
// returns both; all permissions are enforced in code, never trusted from
// the model.

/** Methods/confidences the LLM may never override (spec precedence). */
const PROTECTED_METHODS = new Set(['track-anchor', 'user-correction', 'content-llm']);
const REASSIGNABLE_CONFIDENCE = new Set(['low', 'none']);

/** Most-talkative speaker (by word count) who isn't the user. */
function computeMainParticipant(transcript, user) {
  const counts = new Map(); // key = email||name → {name, email, words}
  const userEmail = (user?.email || '').toLowerCase();
  const userName = (user?.name || '').toLowerCase();
  for (const u of transcript || []) {
    const name = u.speakerName || null;
    const email = (u.speakerEmail || '').toLowerCase() || null;
    if (!name) continue;
    if (email && email === userEmail) continue;
    if (!email && name.toLowerCase() === userName) continue;
    const key = email || name.toLowerCase();
    const words = (u.text || '').trim().split(/\s+/).filter(Boolean).length;
    const cur = counts.get(key) || { name, email: u.speakerEmail || null, words: 0 };
    cur.words += words;
    counts.set(key, cur);
  }
  let best = null;
  for (const c of counts.values()) if (!best || c.words > best.words) best = c;
  return best ? { name: best.name, email: best.email } : null;
}

/** Title Case the topic phrase; assemble "Company - Name - Topic".
 *  The topic is model-supplied: sanitize (strip control chars/newlines,
 *  collapse whitespace), cap at 6 words, and normalize case — the title
 *  lands in filenames and YAML frontmatter downstream. */
function composeTitle(company, participantName, topic) {
  if (!participantName || !topic) return null;
  const cleaned = topic
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const titledTopic = cleaned
    .split(' ')
    .slice(0, 6)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
  return [company, participantName, titledTopic].filter(Boolean).join(' - ');
}

/** Enforce spec permissions: only low/none, only roster names, tag content-llm. */
function applyReassignments(speakerMapping, reassignments, roster) {
  const updated = {};
  for (const [label, entry] of Object.entries(speakerMapping || {})) updated[label] = { ...entry };
  const changed = [];
  for (const r of reassignments || []) {
    if (!r || typeof r !== 'object') continue;
    const entry = updated[r.label];
    if (!entry) continue;
    if (PROTECTED_METHODS.has(entry.method)) continue;
    if (!REASSIGNABLE_CONFIDENCE.has(entry.confidence)) continue;
    const contact = (roster || []).find((a) => (a.name || '').toLowerCase() === (r.name || '').toLowerCase());
    if (!contact) continue; // model may not invent identities
    if ((entry.name || '').toLowerCase() === contact.name.toLowerCase()) continue;
    updated[r.label] = {
      ...entry,
      name: contact.name,
      email: contact.email || null,
      confidence: 'medium',
      method: 'content-llm',
      needsVerification: true,
    };
    if (!changed.includes(r.label)) changed.push(r.label);
  }
  return { updated, changed };
}

/** Pull the first JSON object out of the model output; null when unusable. */
function parseContentPassResponse(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return {
      reassignments: Array.isArray(parsed.reassignments) ? parsed.reassignments : [],
      topic: typeof parsed.topic === 'string' ? parsed.topic.trim() : null,
    };
  } catch {
    return null;
  }
}

/** Cue-taxonomy prompt (spec §5 Stage 3). Transcript rides in cacheableContext. */
function buildContentPassPrompts(speakerMapping, roster) {
  const rosterLines = (roster || [])
    .map((a) => `- ${a.name}${a.organization ? ` (${a.organization})` : ''}${a.email ? ` <${a.email}>` : ''}`)
    .join('\n');
  const mappingLines = Object.entries(speakerMapping || {})
    .map(([label, e]) => `- ${label}: ${e.name || 'Unknown'} [confidence=${e.confidence}, method=${e.method}]`)
    .join('\n');
  const systemPrompt =
    'You review speaker assignments in a meeting transcript and name the meeting. ' +
    'Evidence types to weigh: (1) self-identification ("this is X"); (2) direct address ' +
    '("X, what do you think?" — the NEXT speaker is likely X); (3) role asymmetry ' +
    '(advisor/consultant vs client language); (4) organizational references matching a ' +
    "roster entry's company. Only suggest changing assignments marked confidence=low or none; " +
    'names MUST come from the roster verbatim. Also produce a 3-5 word topic phrase for the meeting. ' +
    'Respond with ONLY a JSON object: {"reassignments":[{"label":"...","name":"..."}],"topic":"..."}';
  const userPrompt =
    `Attendee roster:\n${rosterLines}\n\nCurrent speaker assignments:\n${mappingLines}\n\n` +
    'Review the transcript (provided in context). Return the JSON now.';
  return { systemPrompt, userPrompt };
}

/**
 * Run Stage 3. deps: { generateCompletion(opts) → {content}, log }.
 * input: { transcript, speakerMapping, roster, user, cacheableContext }.
 * Returns { updatedMapping, changed: string[], title: string|null }.
 * Every failure degrades to a no-op (spec §9).
 */
async function runContentAwarePass(deps, input) {
  const { transcript, speakerMapping = {}, roster = [], user, cacheableContext } = input;
  const noop = { updatedMapping: speakerMapping, changed: [], title: null };
  try {
    const { systemPrompt, userPrompt } = buildContentPassPrompts(speakerMapping, roster);
    const result = await deps.generateCompletion({
      systemPrompt,
      userPrompt,
      cacheableContext,
      maxTokens: 1000,
    });
    const parsed = parseContentPassResponse(result?.content);
    if (!parsed) {
      deps.log('[ContentPass] Unparseable LLM response — skipping');
      return noop;
    }
    const { updated, changed } = applyReassignments(speakerMapping, parsed.reassignments, roster);

    // Title: main participant + company are computed deterministically in
    // code — the model only contributes the topic phrase.
    const main = computeMainParticipant(transcript, user);
    const rosterEntry = main
      ? roster.find(
          (a) =>
            (main.email && (a.email || '').toLowerCase() === main.email.toLowerCase()) ||
            (a.name || '').toLowerCase() === main.name.toLowerCase()
        )
      : null;
    const title = main ? composeTitle(rosterEntry?.organization || null, main.name, parsed.topic) : null;

    if (changed.length > 0) deps.log(`[ContentPass] Reassigned: ${changed.join(', ')}`);
    return { updatedMapping: updated, changed, title };
  } catch (err) {
    deps.log(`[ContentPass] Skipped: ${err.message}`);
    return noop;
  }
}

module.exports = {
  runContentAwarePass,
  computeMainParticipant,
  composeTitle,
  applyReassignments,
  parseContentPassResponse,
  buildContentPassPrompts,
};
