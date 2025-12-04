# RD-1: Recall.ai Speaker Diarization Research

## Summary

This document captures research findings for improving speaker identification in recorded transcripts.

**Current State:** Recorded transcripts show "Speaker A/B" instead of actual participant names.

**Root Cause:** The Recall.ai Desktop SDK records audio and provides participant metadata separately from AssemblyAI's speaker diarization, with no correlation between them.

---

## Key Findings

### 1. Recall.ai Desktop SDK Capabilities

The SDK already provides participant information via real-time events:

```javascript
// Current subscription in main.js (line 1479)
events: ['participant_events.join']
```

**Data available from `participant_events.join`:**
| Field | Description | Example |
|-------|-------------|---------|
| `participant.name` | Display name from meeting platform | "John Doe" |
| `participant.id` | Unique participant identifier | "p_abc123" |
| `participant.is_host` | Whether participant is host | `true/false` |
| `participant.platform` | Meeting platform | "zoom", "teams", "meet" |

**Currently implemented in:** `src/main.js:5631` (`processParticipantJoin` function)

### 2. Missing SDK Events (Critical Gap)

The SDK supports additional events that are **NOT currently subscribed**:

| Event | Purpose |
|-------|---------|
| `participant_events.speech_on` | Participant started speaking |
| `participant_events.speech_off` | Participant stopped speaking |
| `participant_events.update` | Participant details changed |

**These speech events would allow correlating Recall.ai participants with AssemblyAI speaker labels!**

### 3. AssemblyAI Speaker Diarization

**Current implementation:** `src/main/services/transcriptionService.js:131`
```javascript
speaker_labels: true  // Enables diarization
```

**What AssemblyAI provides:**
- Generic speaker labels: "Speaker A", "Speaker B", "Speaker C"
- Timestamps for each utterance (start/end in milliseconds)
- Word-level timing data
- Confidence scores

**What AssemblyAI does NOT provide:**
- Actual participant names
- Correlation to meeting platform participant data

**Parameters to improve accuracy:**
- `speakers_expected`: Set expected number of speakers
- `speaker_options.min_speakers` / `speaker_options.max_speakers`: Range

### 4. Meeting Type Detection (RD-1.5)

**Answer: YES, the SDK provides meeting type.**

The `participant.platform` field contains the meeting type:
- `"zoom"` - Zoom meeting
- `"teams"` - Microsoft Teams
- `"meet"` - Google Meet

This is already being captured in the current implementation.

---

## Recommended Solutions

### Solution A: SDK Speech Event Correlation (Recommended)

**Approach:** Use Recall.ai SDK speech events to track who is speaking when, then correlate with AssemblyAI timestamps.

**Implementation:**

1. **Subscribe to speech events:**
```javascript
events: [
  'participant_events.join',
  'participant_events.speech_on',
  'participant_events.speech_off',
]
```

2. **Track speech timeline:**
```javascript
// Store speaking intervals per participant
const speakingTimeline = new Map();
// Key: participant.id
// Value: [{start: timestamp, end: timestamp}, ...]
```

3. **Post-transcription correlation:**
```javascript
// After AssemblyAI returns utterances with timestamps
for (const utterance of transcript.utterances) {
  // Find which participant was speaking at utterance.start
  const speaker = findSpeakerAtTime(utterance.start, speakingTimeline);
  if (speaker) {
    utterance.speakerName = speaker.name;
  }
}
```

**Pros:**
- High accuracy (based on actual speech detection)
- Real-time data, no post-processing guesswork
- Platform-agnostic (works for Zoom, Teams, Meet)

**Cons:**
- Requires SDK subscription changes
- Speech events may have slight timing offsets
- Need to handle overlapping speech

### Solution B: LeMUR Name Inference

**Approach:** Use AssemblyAI's LeMUR (LLM) to infer speaker names from transcript content.

**Implementation:**
```python
# Pass known participants + transcript to LeMUR
questions = [
  aai.LemurQuestion(
    question=f"Who is speaker {speaker}?",
    answer_format="<First Name> <Last Name>"
  )
  for speaker in unique_speakers
]

result = aai.Lemur().question(
  questions,
  input_text=transcript_with_labels,
  context=f"Known participants: {', '.join(participant_names)}"
)
```

**Pros:**
- Works with existing data (no SDK changes)
- Can infer from context clues in conversation

**Cons:**
- Additional API cost (LeMUR calls)
- Lower accuracy for short meetings
- May fail if names aren't mentioned

### Solution C: Enhanced Heuristics (Current Approach)

**Current implementation:** `src/main/integrations/SpeakerMatcher.js`

**Heuristics used:**
1. Count matching (if speakers = participants, 1:1 map)
2. First speaker = meeting organizer
3. Most talkative = host
4. Sequential mapping for remainder

**Pros:**
- No additional API calls
- Simple implementation

**Cons:**
- Low accuracy (often wrong)
- No real confidence
- Doesn't scale beyond 2-3 participants

---

## Implementation Recommendation

**Phase 1 (v1.1):** Implement Solution A (SDK Speech Events)
- Highest accuracy
- No additional API costs
- Leverages data we're already receiving

**Phase 2 (Future):** Add Solution B as fallback
- Use LeMUR when speech events are unavailable (imports)
- Provide confidence scores to users

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/main.js` | Add speech event subscriptions, implement timeline tracking |
| `src/main/integrations/SpeakerMatcher.js` | Add timeline correlation logic |
| `src/main/services/transcriptionService.js` | Pass participant data to matcher |

---

## Testing Checklist

- [ ] Verify `speech_on`/`speech_off` events fire correctly for Zoom
- [ ] Verify events fire correctly for Microsoft Teams
- [ ] Verify events fire correctly for Google Meet
- [ ] Test correlation accuracy with 2 participants
- [ ] Test correlation accuracy with 3+ participants
- [ ] Test handling of overlapping speech
- [ ] Test when participant joins late
- [ ] Test when participant leaves early

---

## References

- Recall.ai Desktop SDK Events: https://docs.recall.ai/docs/desktop-sdk
- AssemblyAI Speaker Diarization: https://www.assemblyai.com/docs/speech-to-text/pre-recorded-audio/speaker-diarization
- AssemblyAI LeMUR Speaker ID: https://www.assemblyai.com/docs/guides/speaker-identification
- Current SpeakerMatcher: `src/main/integrations/SpeakerMatcher.js`
- Current processParticipantJoin: `src/main.js:5631`
