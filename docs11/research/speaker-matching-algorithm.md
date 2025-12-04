# RD-5: Speaker Matching Algorithm Design

## Summary

This document designs an improved speaker-to-participant matching algorithm using multiple signals: SDK speech events, calendar participants, transcript content analysis, and learned mappings.

---

## Current Implementation Analysis

### Existing Approach (`SpeakerMatcher.js`)

**Signals Used:**
1. Speaker count matching (if speakers = participants, do 1:1)
2. First speaker = organizer assumption
3. Most talkative speaker = host assumption
4. Sequential mapping for remainder

**Limitations:**
- Low confidence for most matches
- No use of Recall.ai speech events
- No transcript content analysis
- No learning from previous mappings
- Assumes organizer speaks first (often wrong)

**Confidence Ratings:**
- `count-match`: medium
- `first-speaker`: low
- `most-talkative`: low
- `sequential`: low
- `unmatched`: none

---

## Research Findings

### Industry Best Practices

From [2024 research](https://www.isca-archive.org/interspeech_2024/boeddeker24_interspeech.html):
- Segment-level speaker reassignment can fix 40% of speaker confusion errors
- Timestamp accuracy is critical for matching
- Multi-pass approaches improve accuracy

From [Recall.ai](https://www.gladia.io/blog/using-gladia-speech-to-text-api-with-virtual-meeting-recordings):
- Meeting platforms (Zoom, Teams) provide separate audio streams per participant
- This enables 100% accurate speaker diarization when available

### Key Insight

**The Recall.ai Desktop SDK provides speech events with participant names**, but we're not currently using them. This is the single biggest improvement opportunity.

---

## Improved Algorithm Design

### Multi-Signal Approach

Combine multiple signals with weighted scoring:

```
┌─────────────────────────────────────────────────────────────────┐
│                    SIGNAL SOURCES                                │
├─────────────────────────────────────────────────────────────────┤
│  1. SDK Speech Timeline (highest confidence)                    │
│     - participant_events.speech_on / speech_off                 │
│     - Correlate with AssemblyAI utterance timestamps           │
│                                                                  │
│  2. Participant List (from calendar)                            │
│     - Who was invited                                           │
│     - Meeting organizer                                         │
│                                                                  │
│  3. Transcript Content Analysis                                 │
│     - Names mentioned in conversation                           │
│     - Self-introductions ("Hi, I'm John...")                    │
│     - Name addressing ("Thanks, Sarah...")                      │
│                                                                  │
│  4. Previous Mappings (learned)                                 │
│     - SPK-xxx IDs from imports                                  │
│     - Historical speaker patterns                               │
│                                                                  │
│  5. Heuristics (fallback)                                       │
│     - Speaking patterns                                         │
│     - Organizer assumptions                                     │
└─────────────────────────────────────────────────────────────────┘
```

### Signal 1: SDK Speech Timeline Correlation

**Highest confidence method for recorded meetings.**

```javascript
class SpeechTimelineCorrelator {
  constructor() {
    // Map: participantId -> [{start, end}, ...]
    this.speakingTimeline = new Map();
  }

  /**
   * Record when a participant starts speaking
   * Called from participant_events.speech_on handler
   */
  onSpeechStart(participantId, participantName, timestamp) {
    if (!this.speakingTimeline.has(participantId)) {
      this.speakingTimeline.set(participantId, {
        name: participantName,
        segments: []
      });
    }
    this.speakingTimeline.get(participantId).currentStart = timestamp;
  }

  /**
   * Record when a participant stops speaking
   * Called from participant_events.speech_off handler
   */
  onSpeechEnd(participantId, timestamp) {
    const participant = this.speakingTimeline.get(participantId);
    if (participant && participant.currentStart) {
      participant.segments.push({
        start: participant.currentStart,
        end: timestamp
      });
      delete participant.currentStart;
    }
  }

  /**
   * Find which participant was speaking at a given timestamp
   * @param {number} timestamp - Time in milliseconds
   * @param {number} tolerance - Tolerance window in ms (default 500ms)
   */
  findSpeakerAtTime(timestamp, tolerance = 500) {
    let bestMatch = null;
    let bestOverlap = 0;

    for (const [participantId, data] of this.speakingTimeline) {
      for (const segment of data.segments) {
        // Check if timestamp falls within segment (with tolerance)
        const segStart = segment.start - tolerance;
        const segEnd = segment.end + tolerance;

        if (timestamp >= segStart && timestamp <= segEnd) {
          const overlap = Math.min(segEnd, timestamp + 100) -
                          Math.max(segStart, timestamp);
          if (overlap > bestOverlap) {
            bestOverlap = overlap;
            bestMatch = {
              participantId,
              name: data.name,
              confidence: 'high'
            };
          }
        }
      }
    }

    return bestMatch;
  }

  /**
   * Correlate AssemblyAI utterances with SDK speech timeline
   */
  correlateUtterances(utterances) {
    const mapping = {};
    const speakerMatches = new Map(); // speaker -> {participant, count}

    for (const utterance of utterances) {
      const speaker = utterance.speaker;
      const timestamp = utterance.start; // AssemblyAI timestamp in ms

      const match = this.findSpeakerAtTime(timestamp);
      if (match) {
        if (!speakerMatches.has(speaker)) {
          speakerMatches.set(speaker, new Map());
        }
        const participantCounts = speakerMatches.get(speaker);
        const count = participantCounts.get(match.participantId) || 0;
        participantCounts.set(match.participantId, count + 1);
      }
    }

    // Assign speaker to most frequently matched participant
    for (const [speaker, participantCounts] of speakerMatches) {
      let bestParticipant = null;
      let bestCount = 0;

      for (const [participantId, count] of participantCounts) {
        if (count > bestCount) {
          bestCount = count;
          bestParticipant = this.speakingTimeline.get(participantId);
        }
      }

      if (bestParticipant) {
        mapping[speaker] = {
          name: bestParticipant.name,
          confidence: 'high',
          method: 'speech-timeline',
          matchCount: bestCount
        };
      }
    }

    return mapping;
  }
}
```

### Signal 2: Transcript Content Analysis

**Extract names mentioned in conversation.**

```javascript
class TranscriptAnalyzer {
  /**
   * Find self-introductions in transcript
   * Patterns: "I'm [Name]", "This is [Name]", "My name is [Name]"
   */
  findIntroductions(transcript) {
    const introPatterns = [
      /(?:I'm|I am|This is|My name is|It's)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
      /(?:Hi,?\s+)?([A-Z][a-z]+)\s+(?:here|speaking)/g
    ];

    const introductions = new Map(); // speaker -> [mentioned names]

    for (const utterance of transcript) {
      for (const pattern of introPatterns) {
        const matches = utterance.text.matchAll(pattern);
        for (const match of matches) {
          const name = match[1];
          if (!introductions.has(utterance.speaker)) {
            introductions.set(utterance.speaker, []);
          }
          introductions.get(utterance.speaker).push(name);
        }
      }
    }

    return introductions;
  }

  /**
   * Find names addressed in conversation
   * Patterns: "Thanks [Name]", "[Name], what do you think?"
   */
  findAddressedNames(transcript, participants) {
    const participantNames = participants.map(p => p.name?.split(' ')[0]).filter(Boolean);
    const addressed = new Map(); // speaker -> [names they addressed]

    for (const utterance of transcript) {
      for (const name of participantNames) {
        const pattern = new RegExp(`\\b${name}\\b`, 'gi');
        if (pattern.test(utterance.text)) {
          if (!addressed.has(utterance.speaker)) {
            addressed.set(utterance.speaker, []);
          }
          addressed.get(utterance.speaker).push(name);
        }
      }
    }

    return addressed;
  }

  /**
   * Score speaker-participant matches based on content analysis
   */
  scoreMatches(transcript, participants) {
    const scores = new Map(); // speaker -> {participant -> score}
    const introductions = this.findIntroductions(transcript);
    const addressed = this.findAddressedNames(transcript, participants);

    // Self-introductions are strong signals
    for (const [speaker, names] of introductions) {
      for (const name of names) {
        const match = participants.find(p =>
          p.name?.toLowerCase().includes(name.toLowerCase())
        );
        if (match) {
          if (!scores.has(speaker)) scores.set(speaker, new Map());
          const current = scores.get(speaker).get(match.email) || 0;
          scores.get(speaker).set(match.email, current + 10); // High weight
        }
      }
    }

    // Addressed names suggest OTHER speakers (inverse signal)
    // If Speaker A addresses "John", Speaker A is probably NOT John
    for (const [speaker, names] of addressed) {
      for (const name of names) {
        const match = participants.find(p =>
          p.name?.toLowerCase().includes(name.toLowerCase())
        );
        if (match) {
          if (!scores.has(speaker)) scores.set(speaker, new Map());
          const current = scores.get(speaker).get(match.email) || 0;
          scores.get(speaker).set(match.email, current - 5); // Negative weight
        }
      }
    }

    return scores;
  }
}
```

### Signal 3: Previous Speaker ID Mappings

**Learn from user corrections and import mappings.**

```javascript
class SpeakerMappingStore {
  constructor(storagePath) {
    this.storagePath = storagePath;
    this.mappings = new Map(); // speakerId -> {name, email, confidence, lastUsed}
  }

  /**
   * Load saved mappings from disk
   */
  async load() {
    // Load from JSON file
    const data = await fs.readFile(this.storagePath, 'utf8');
    const parsed = JSON.parse(data);
    for (const [id, mapping] of Object.entries(parsed)) {
      this.mappings.set(id, mapping);
    }
  }

  /**
   * Save a new or updated mapping
   */
  async saveMapping(speakerId, name, email) {
    this.mappings.set(speakerId, {
      name,
      email,
      confidence: 'user-confirmed',
      lastUsed: Date.now()
    });
    await this.persist();
  }

  /**
   * Look up a speaker ID (e.g., SPK-72zlg25bsiw from imports)
   */
  getSuggestion(speakerId) {
    return this.mappings.get(speakerId);
  }
}
```

### Combined Algorithm

```javascript
class ImprovedSpeakerMatcher {
  constructor(options = {}) {
    this.speechTimeline = new SpeechTimelineCorrelator();
    this.transcriptAnalyzer = new TranscriptAnalyzer();
    this.mappingStore = new SpeakerMappingStore(options.storagePath);
  }

  /**
   * Match speakers to participants using all available signals
   */
  async matchSpeakers(transcript, participants, options = {}) {
    const {
      speechEvents = [], // From SDK
      meetingOrganizer = null,
      useContentAnalysis = true
    } = options;

    const mapping = {};
    const scores = new Map(); // speaker -> {participant -> score}

    // Initialize scores
    const speakers = this.getUniqueSpeakers(transcript);
    for (const speaker of speakers) {
      scores.set(speaker, new Map());
      for (const participant of participants) {
        scores.get(speaker).set(participant.email, 0);
      }
    }

    // Signal 1: SDK Speech Timeline (highest weight)
    if (speechEvents.length > 0) {
      const timelineMapping = this.speechTimeline.correlateUtterances(transcript);
      for (const [speaker, match] of Object.entries(timelineMapping)) {
        if (match.confidence === 'high') {
          mapping[speaker] = match; // Direct assignment for high confidence
        }
      }
    }

    // Signal 2: Previous mappings (for imports)
    for (const speaker of speakers) {
      if (mapping[speaker]) continue; // Already matched

      const suggestion = this.mappingStore.getSuggestion(speaker);
      if (suggestion) {
        scores.get(speaker).set(suggestion.email,
          (scores.get(speaker).get(suggestion.email) || 0) + 8);
      }
    }

    // Signal 3: Content analysis
    if (useContentAnalysis) {
      const contentScores = this.transcriptAnalyzer.scoreMatches(
        transcript, participants
      );
      for (const [speaker, participantScores] of contentScores) {
        for (const [email, score] of participantScores) {
          const current = scores.get(speaker)?.get(email) || 0;
          scores.get(speaker)?.set(email, current + score);
        }
      }
    }

    // Signal 4: Meeting organizer (if known)
    if (meetingOrganizer) {
      // First speaker is often the organizer
      const firstSpeaker = this.getFirstSpeaker(transcript);
      if (firstSpeaker && !mapping[firstSpeaker]) {
        const current = scores.get(firstSpeaker)?.get(meetingOrganizer) || 0;
        scores.get(firstSpeaker)?.set(meetingOrganizer, current + 3);
      }
    }

    // Signal 5: Speaking patterns (fallback heuristics)
    const speakerStats = this.analyzeSpeakers(transcript);
    this.applyPatternHeuristics(scores, speakerStats, participants);

    // Resolve final mapping from scores
    this.resolveMapping(mapping, scores, participants);

    return mapping;
  }

  /**
   * Resolve scores to final speaker-participant mapping
   * Uses Hungarian algorithm for optimal assignment
   */
  resolveMapping(mapping, scores, participants) {
    const unmappedSpeakers = [];
    const unmappedParticipants = new Set(participants.map(p => p.email));

    // Remove already-mapped participants
    for (const match of Object.values(mapping)) {
      unmappedParticipants.delete(match.email);
    }

    // Get unmapped speakers
    for (const speaker of scores.keys()) {
      if (!mapping[speaker]) {
        unmappedSpeakers.push(speaker);
      }
    }

    // Greedy assignment based on highest scores
    // (Could use Hungarian algorithm for optimal assignment)
    for (const speaker of unmappedSpeakers) {
      let bestEmail = null;
      let bestScore = -Infinity;

      for (const email of unmappedParticipants) {
        const score = scores.get(speaker)?.get(email) || 0;
        if (score > bestScore) {
          bestScore = score;
          bestEmail = email;
        }
      }

      if (bestEmail && bestScore > 0) {
        const participant = participants.find(p => p.email === bestEmail);
        mapping[speaker] = {
          email: bestEmail,
          name: participant?.name || bestEmail,
          confidence: this.scoreToConfidence(bestScore),
          method: 'multi-signal',
          score: bestScore
        };
        unmappedParticipants.delete(bestEmail);
      } else {
        mapping[speaker] = {
          email: null,
          name: `Unknown (${speaker})`,
          confidence: 'none',
          method: 'unmatched'
        };
      }
    }
  }

  scoreToConfidence(score) {
    if (score >= 10) return 'high';
    if (score >= 5) return 'medium';
    if (score > 0) return 'low';
    return 'none';
  }
}
```

---

## Confidence Scoring

| Confidence | Score Range | Signals |
|------------|-------------|---------|
| **high** | 10+ | SDK speech timeline match, or user-confirmed |
| **medium** | 5-9 | Multiple weak signals agreeing, or content analysis match |
| **low** | 1-4 | Single weak signal (heuristic) |
| **none** | 0 or negative | No matching signals |

---

## Implementation Plan

### Phase 1: SDK Speech Events (v1.1)

1. Subscribe to `speech_on` and `speech_off` events
2. Build speech timeline during recording
3. Correlate with AssemblyAI utterances post-transcription
4. Use for recorded meetings (highest accuracy)

### Phase 2: Content Analysis (v1.1)

1. Implement introduction detection
2. Implement name addressing detection
3. Add to scoring system

### Phase 3: Learned Mappings (v1.1)

1. Store user-confirmed mappings
2. Auto-suggest for recurring speaker IDs (imports)
3. Persist across sessions

### Phase 4: UI Improvements (v1.1)

1. Show confidence level in speaker mapping UI
2. Allow user to confirm/correct suggestions
3. Save corrections to mapping store

---

## Testing Checklist

- [ ] Test SDK speech event recording
- [ ] Test timeline correlation with AssemblyAI timestamps
- [ ] Test introduction detection patterns
- [ ] Test name addressing detection
- [ ] Test learned mapping persistence
- [ ] Test with 2-person meeting
- [ ] Test with 3+ person meeting
- [ ] Test with imported transcript (SPK-xxx IDs)
- [ ] Verify confidence levels are accurate

---

## References

- [Interspeech 2024: Segment-level Speaker Reassignment](https://www.isca-archive.org/interspeech_2024/boeddeker24_interspeech.html)
- [Gladia: Speech-to-Text API Best Practices](https://www.gladia.io/blog/using-gladia-speech-to-text-api-with-virtual-meeting-recordings)
- [WhisperX: Word-level Timestamps with Diarization](https://github.com/m-bain/whisperX)
- Current implementation: `src/main/integrations/SpeakerMatcher.js`
