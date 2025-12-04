# RD-2: Transcription Provider Vocabulary Features

## Summary

This document captures research findings for implementing custom vocabulary to improve transcription accuracy for client names, company names, and industry jargon.

---

## Provider Comparison

### AssemblyAI: Custom Spelling

**Feature Name:** `custom_spelling`

**How it works:**
- Maps incorrect transcriptions TO correct spellings
- Applied during transcription (not post-processing)
- Uses a find/replace approach

**API Usage:**
```javascript
const params = {
  audio: audioFile,
  speaker_labels: true,
  custom_spelling: [
    { from: ["Decarlo"], to: "DeCarlo" },
    { from: ["Sequel"], to: "SQL" },
    { from: ["acme corp", "akme"], to: "ACME Corp" }
  ]
};

const transcript = await client.transcripts.transcribe(params);
```

**Characteristics:**
| Aspect | Details |
|--------|---------|
| Type | Find/Replace spelling correction |
| When Applied | During transcription |
| Format | Array of `{from: [], to: ""}` objects |
| Limit | Not specified (test for practical limits) |
| Case Sensitivity | Can correct casing |
| Multi-word | Supports phrases |

**Pros:**
- Simple to implement
- Corrects specific known misspellings
- Applied at transcription time (no post-processing needed)

**Cons:**
- Must know the incorrect spelling in advance
- Doesn't "boost" recognition of rare words
- Reactive (fixing known issues) rather than proactive

---

### Deepgram: Keyword Boosting

**Feature Name:** `keywords`

**How it works:**
- Boosts probability of recognizing specific words
- Uses intensifier values (-10 to +10)
- Positive = boost recognition, Negative = suppress

**API Usage:**
```javascript
// Via URL parameters
const url = 'https://api.deepgram.com/v1/listen?diarize=true&keywords=Anthropic:5&keywords=GPT-4:3';

// Or via body (if supported)
const params = {
  keywords: ["Anthropic:5", "GPT-4:3", "claude:5"]
};
```

**Characteristics:**
| Aspect | Details |
|--------|---------|
| Type | Probability boosting |
| When Applied | During transcription |
| Format | `keyword:intensifier` (e.g., `word:5`) |
| Limit | Up to 200 keywords |
| Intensifier Range | -10 (suppress) to +10 (strong boost) |
| Case | Keywords appear as provided |

**Pros:**
- Proactively improves recognition of rare/technical terms
- Can suppress unwanted words
- Works well for proper nouns, brand names, jargon
- Up to 200 keywords supported

**Cons:**
- Requires Enhanced or Nova models for best results
- Doesn't correct alternate spellings
- May need to tune intensifier values

---

## Comparison Summary

| Feature | AssemblyAI | Deepgram |
|---------|------------|----------|
| Approach | Spelling correction | Probability boosting |
| Best For | Known misspellings | Rare/technical terms |
| When Applied | Transcription time | Transcription time |
| Post-processing | LeMUR option available | N/A |
| Limit | Unknown | 200 keywords |
| Configuration | `from`/`to` mapping | `keyword:intensifier` |

---

## Recommended Implementation (RD-2.3 & RD-2.4)

### Timing Decision: Transcription Time (Not Post-Processing)

**Recommendation:** Apply vocabulary at transcription time for both providers.

**Rationale:**
1. Post-processing requires additional API calls (LeMUR) = more cost
2. Post-processing adds latency to meeting workflow
3. Both providers natively support transcription-time vocabulary
4. Post-processing is only needed for legacy transcripts

### Vocabulary Structure Design

```yaml
# config/vocabulary.yaml

# Global vocabulary - applied to all transcriptions
global:
  # For AssemblyAI (custom_spelling)
  spelling_corrections:
    - from: ["ai", "A.I."]
      to: "AI"
    - from: ["gpt4", "gpt-4"]
      to: "GPT-4"

  # For Deepgram (keywords with intensifiers)
  keyword_boosts:
    - word: "Anthropic"
      intensifier: 5
    - word: "Claude"
      intensifier: 5

# Client-specific vocabulary
clients:
  acme-corp:
    spelling_corrections:
      - from: ["akme", "acme"]
        to: "ACME"
    keyword_boosts:
      - word: "ACME"
        intensifier: 5
      - word: "RoadRunner"
        intensifier: 3

  tech-startup:
    keyword_boosts:
      - word: "TechStartup"
        intensifier: 5
      - word: "InnovatePlatform"
        intensifier: 4
```

### Provider Abstraction

Create a vocabulary formatter that translates our unified format to provider-specific formats:

```javascript
// vocabularyService.js

class VocabularyService {
  /**
   * Format vocabulary for AssemblyAI
   * @param {Object} vocabulary - Merged global + client vocabulary
   * @returns {Array} custom_spelling array for AssemblyAI
   */
  formatForAssemblyAI(vocabulary) {
    const customSpelling = [];

    // Add spelling corrections
    if (vocabulary.spelling_corrections) {
      customSpelling.push(...vocabulary.spelling_corrections);
    }

    // Convert keyword boosts to spelling (AssemblyAI doesn't have boosting)
    // This just ensures proper casing/spelling
    if (vocabulary.keyword_boosts) {
      vocabulary.keyword_boosts.forEach(kb => {
        customSpelling.push({
          from: [kb.word.toLowerCase()],
          to: kb.word
        });
      });
    }

    return customSpelling;
  }

  /**
   * Format vocabulary for Deepgram
   * @param {Object} vocabulary - Merged global + client vocabulary
   * @returns {Array} keywords array for Deepgram URL params
   */
  formatForDeepgram(vocabulary) {
    const keywords = [];

    // Deepgram uses keyword boosting primarily
    if (vocabulary.keyword_boosts) {
      vocabulary.keyword_boosts.forEach(kb => {
        keywords.push(`${kb.word}:${kb.intensifier}`);
      });
    }

    // For spelling corrections, add the "to" word as a boost
    if (vocabulary.spelling_corrections) {
      vocabulary.spelling_corrections.forEach(sc => {
        keywords.push(`${sc.to}:3`); // Default boost of 3
      });
    }

    return keywords;
  }
}
```

### Client Detection for Vocabulary Selection

Determine which client vocabulary to apply based on meeting participants:

```javascript
/**
 * Get vocabulary for a meeting based on participants
 * @param {Array} participantEmails - Participant email addresses
 * @returns {Object} Merged vocabulary (global + client-specific)
 */
async function getVocabularyForMeeting(participantEmails) {
  const globalVocab = await loadGlobalVocabulary();

  // Use routing engine to determine client from participants
  const client = await routingEngine.matchClient(participantEmails);

  if (client) {
    const clientVocab = await loadClientVocabulary(client.slug);
    return mergeVocabulary(globalVocab, clientVocab);
  }

  return globalVocab;
}
```

---

## Implementation Files

| File | Changes |
|------|---------|
| `config/vocabulary.yaml` | New - Global and client vocabulary storage |
| `src/main/services/vocabularyService.js` | New - Vocabulary loading and formatting |
| `src/main/services/transcriptionService.js` | Add vocabulary parameter to transcribe calls |
| Settings UI | Add vocabulary management interface |

---

## Testing Checklist

- [ ] Test AssemblyAI with custom_spelling parameter
- [ ] Test Deepgram with keywords parameter
- [ ] Verify vocabulary merging (global + client)
- [ ] Test with technical jargon (acronyms, product names)
- [ ] Test with proper nouns (company names, people names)
- [ ] Verify no performance impact on transcription time
- [ ] Test vocabulary export/import with settings

---

## References

- AssemblyAI Custom Spelling: https://www.assemblyai.com/docs/speech-to-text/pre-recorded-audio/custom-spelling
- AssemblyAI LeMUR Custom Vocab: https://www.assemblyai.com/docs/guides/custom-vocab-lemur
- Deepgram Keywords: https://developers.deepgram.com/docs/keywords
- Current transcriptionService: `src/main/services/transcriptionService.js`
