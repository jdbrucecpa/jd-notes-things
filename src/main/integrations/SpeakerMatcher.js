/**
 * SpeakerMatcher - Matches diarized speakers to meeting participants
 * Phase 6: Speaker Recognition & Contact Matching
 * SM-1: Enhanced with SDK speech timeline correlation for high-confidence matching
 */

class SpeakerMatcher {
  constructor(googleContacts) {
    this.googleContacts = googleContacts;
  }

  /**
   * Match speakers in transcript to meeting participants
   * @param {Array} transcript - Array of transcript utterances with speaker labels
   * @param {Array} participantEmails - Array of participant email addresses
   * @param {Object} options - Matching options
   * @param {Object} options.speechTimeline - Optional SDK speech timeline for high-confidence matching
   * @returns {Object} Speaker mapping (speakerLabel -> participant info)
   */
  async matchSpeakers(transcript, participantEmails, options = {}) {
    const {
      includeOrganizer: _includeOrganizer = true,
      useWordCount: _useWordCount = true,
      useTimingHeuristics: _useTimingHeuristics = true,
      speechTimeline = null, // SM-1: SDK speech events for high-confidence matching
    } = options;

    if (!transcript || transcript.length === 0) {
      console.log('[SpeakerMatcher] Empty transcript - no speakers to match');
      return {};
    }

    if (!participantEmails || participantEmails.length === 0) {
      console.log('[SpeakerMatcher] No participants - cannot match speakers');
      return {};
    }

    console.log(
      `[SpeakerMatcher] Matching ${this.getSpeakerCount(transcript)} speakers to ${participantEmails.length} participants`
    );

    // Step 1: Get contact information for all participants
    const contacts = await this.googleContacts.findContactsByEmails(participantEmails);
    console.log(
      `[SpeakerMatcher] Found ${contacts.size} contacts out of ${participantEmails.length} participants`
    );

    // Step 2: Analyze speakers in transcript
    const speakerStats = this.analyzeSpeakers(transcript);

    // Step 3: SM-1 - Try high-confidence matching using SDK speech timeline first
    let speakerMapping = {};
    if (speechTimeline && speechTimeline.participants && speechTimeline.participants.length > 0) {
      console.log('[SpeakerMatcher] SM-1: Using SDK speech timeline for high-confidence matching');
      speakerMapping = this.matchUsingTimeline(
        transcript,
        speechTimeline,
        participantEmails,
        contacts
      );
    }

    // Step 4: Fall back to heuristics for unmatched speakers
    const matchedSpeakers = new Set(Object.keys(speakerMapping));
    const unmatchedStats = new Map(
      Array.from(speakerStats.entries()).filter(([label]) => !matchedSpeakers.has(label))
    );

    if (unmatchedStats.size > 0) {
      console.log(
        `[SpeakerMatcher] Using heuristics for ${unmatchedStats.size} unmatched speakers`
      );
      const heuristicMapping = this.createSpeakerMapping(
        unmatchedStats,
        participantEmails,
        contacts,
        options,
        speakerMapping // Pass existing mapping to avoid duplicate assignments
      );

      // Merge heuristic matches with timeline matches
      speakerMapping = { ...speakerMapping, ...heuristicMapping };
    }

    console.log('[SpeakerMatcher] Speaker matching complete:', speakerMapping);
    return speakerMapping;
  }

  /**
   * SM-1: Match speakers using SDK speech timeline correlation
   * Correlates AssemblyAI utterance timestamps with SDK speech events
   * @param {Array} transcript - Transcript utterances with timestamps
   * @param {Object} speechTimeline - SDK speech timeline data
   * @param {Array} participantEmails - Participant emails for validation
   * @param {Map} contacts - Contact information
   * @returns {Object} High-confidence speaker mapping
   */
  matchUsingTimeline(transcript, speechTimeline, participantEmails, contacts) {
    const mapping = {};
    const speakerMatchCounts = new Map(); // speakerLabel -> Map<participantName, count>
    const toleranceMs = 2000; // 2 second tolerance window for timestamp matching

    console.log(
      `[SpeakerMatcher] SM-1: Timeline has ${speechTimeline.participants.length} SDK participants`
    );

    // Debug: log speech timeline segments
    for (const participant of speechTimeline.participants) {
      console.log(
        `[SpeakerMatcher] SM-1: ${participant.name} has ${participant.segments.length} speech segments`
      );
      for (const seg of participant.segments.slice(0, 3)) {
        console.log(`[SpeakerMatcher] SM-1:   - segment: ${seg.start}ms to ${seg.end}ms`);
      }
    }

    // For each utterance, find which SDK participant was speaking at that time
    for (const utterance of transcript) {
      if (!utterance.speaker) continue;

      // Transcript entries use 'timestamp' for start time (already in milliseconds)
      // Calculate end time from words array if available, otherwise estimate
      const utteranceStartMs = utterance.timestamp || 0;
      let utteranceEndMs = utteranceStartMs;
      if (utterance.words && utterance.words.length > 0) {
        const lastWord = utterance.words[utterance.words.length - 1];
        utteranceEndMs = lastWord.end || utteranceStartMs;
      }

      console.log(
        `[SpeakerMatcher] SM-1: Utterance "${utterance.text?.substring(0, 30)}..." at ${utteranceStartMs}-${utteranceEndMs}ms`
      );

      // Find SDK participant speaking at this time
      for (const sdkParticipant of speechTimeline.participants) {
        for (const segment of sdkParticipant.segments) {
          // Check if utterance overlaps with speech segment (with tolerance)
          const segStart = segment.start - toleranceMs;
          const segEnd = segment.end + toleranceMs;

          if (
            (utteranceStartMs >= segStart && utteranceStartMs <= segEnd) ||
            (utteranceEndMs >= segStart && utteranceEndMs <= segEnd)
          ) {
            // Found a match - track it
            if (!speakerMatchCounts.has(utterance.speaker)) {
              speakerMatchCounts.set(utterance.speaker, new Map());
            }

            const participantCounts = speakerMatchCounts.get(utterance.speaker);
            const currentCount = participantCounts.get(sdkParticipant.name) || 0;
            participantCounts.set(sdkParticipant.name, currentCount + 1);
            break; // One match per segment is enough
          }
        }
      }
    }

    // Assign each speaker to their most frequently matched participant
    const assignedParticipants = new Set();

    for (const [speakerLabel, participantCounts] of speakerMatchCounts) {
      let bestParticipant = null;
      let bestCount = 0;

      for (const [participantName, count] of participantCounts) {
        if (count > bestCount && !assignedParticipants.has(participantName)) {
          bestCount = count;
          bestParticipant = participantName;
        }
      }

      if (bestParticipant && bestCount >= 2) {
        // Require at least 2 matches for confidence
        // Find the email for this participant if available
        const participantEmail = this.findEmailForParticipant(
          bestParticipant,
          participantEmails,
          contacts
        );

        mapping[speakerLabel] = {
          email: participantEmail,
          name: bestParticipant,
          confidence: bestCount >= 5 ? 'high' : 'medium',
          method: 'speech-timeline',
          matchCount: bestCount,
        };

        assignedParticipants.add(bestParticipant);
        console.log(
          `[SpeakerMatcher] SM-1: Matched ${speakerLabel} -> ${bestParticipant} (${bestCount} matches, ${mapping[speakerLabel].confidence} confidence)`
        );
      }
    }

    return mapping;
  }

  /**
   * SM-1: Find email address for a participant by name
   * @param {string} participantName - Name from SDK
   * @param {Array} participantEmails - Available participant emails
   * @param {Map} contacts - Contact information
   * @returns {string|null} Email if found
   */
  findEmailForParticipant(participantName, participantEmails, contacts) {
    if (!participantName) return null;

    const nameLower = participantName.toLowerCase();

    // Try to find by contact name
    for (const [email, contact] of contacts) {
      if (contact.name && contact.name.toLowerCase() === nameLower) {
        return email;
      }
      if (contact.givenName && contact.givenName.toLowerCase() === nameLower.split(' ')[0]) {
        return email;
      }
    }

    // Try to find by extracting name from email
    for (const email of participantEmails) {
      const extractedName = this.extractNameFromEmail(email);
      if (extractedName.toLowerCase() === nameLower) {
        return email;
      }
    }

    return null;
  }

  /**
   * Count unique speakers in transcript
   * @param {Array} transcript - Transcript utterances
   * @returns {number} Number of unique speakers
   */
  getSpeakerCount(transcript) {
    const speakers = new Set();
    for (const utterance of transcript) {
      if (utterance.speaker) {
        speakers.add(utterance.speaker);
      }
    }
    return speakers.size;
  }

  /**
   * Analyze speaker characteristics from transcript
   * @param {Array} transcript - Transcript utterances
   * @returns {Map} Speaker statistics
   */
  analyzeSpeakers(transcript) {
    const stats = new Map();

    for (const utterance of transcript) {
      const speaker = utterance.speaker;
      if (!speaker) continue;

      if (!stats.has(speaker)) {
        stats.set(speaker, {
          label: speaker,
          wordCount: 0,
          utteranceCount: 0,
          firstAppearance: utterance.start || 0,
          lastAppearance: utterance.end || 0,
          totalDuration: 0,
        });
      }

      const speakerData = stats.get(speaker);
      speakerData.utteranceCount++;
      speakerData.wordCount += (utterance.text || '').split(/\s+/).length;

      if (utterance.start < speakerData.firstAppearance) {
        speakerData.firstAppearance = utterance.start;
      }
      if (utterance.end > speakerData.lastAppearance) {
        speakerData.lastAppearance = utterance.end;
      }

      speakerData.totalDuration = speakerData.lastAppearance - speakerData.firstAppearance;
    }

    return stats;
  }

  /**
   * Create speaker to participant mapping using heuristics
   * @param {Map} speakerStats - Speaker statistics
   * @param {Array} participantIdentifiers - Participant emails or names
   * @param {Map} contacts - Contact information
   * @param {Object} options - Matching options
   * @param {Object} existingMapping - Optional existing mapping to avoid duplicate assignments (SM-1)
   * @returns {Object} Speaker mapping
   */
  createSpeakerMapping(
    speakerStats,
    participantIdentifiers,
    contacts,
    options,
    existingMapping = {}
  ) {
    const mapping = {};

    // SM-1: Track participants already assigned via speech timeline
    const alreadyAssignedParticipants = new Set(
      Object.values(existingMapping)
        .filter(m => m.email)
        .map(m => m.email)
    );
    const alreadyAssignedNames = new Set(
      Object.values(existingMapping)
        .filter(m => m.name)
        .map(m => m.name)
    );

    // Convert speaker stats to array and sort by word count (most talkative first)
    const speakers = Array.from(speakerStats.values()).sort((a, b) => b.wordCount - a.wordCount);

    // SM-1: Use participantData from options if available, otherwise build from identifiers
    let participants;
    if (options.participantData && options.participantData.length > 0) {
      // Use full participant objects directly
      participants = options.participantData
        .filter(p => !alreadyAssignedParticipants.has(p.email) && !alreadyAssignedNames.has(p.name))
        .map(p => ({
          email: p.email || null,
          name: p.name || 'Unknown',
          givenName: p.givenName || '',
          familyName: p.familyName || '',
          contact: contacts.get(p.email) || null,
        }));
      console.log(
        `[SpeakerMatcher] Using ${participants.length} participants from participantData`
      );
    } else {
      // Build from identifiers (emails or names)
      participants = participantIdentifiers
        .filter(id => !alreadyAssignedParticipants.has(id) && !alreadyAssignedNames.has(id))
        .map(identifier => {
          // Check if identifier is an email (contains @) or a name
          const isEmail = identifier.includes('@');
          if (isEmail) {
            const contact = contacts.get(identifier);
            const name = contact?.name || this.extractNameFromEmail(identifier);
            return {
              email: identifier,
              name,
              givenName: contact?.givenName || '',
              familyName: contact?.familyName || '',
              contact: contact,
            };
          } else {
            // It's a name, not an email
            return {
              email: null,
              name: identifier,
              givenName: identifier.split(' ')[0] || '',
              familyName: identifier.split(' ').slice(1).join(' ') || '',
              contact: null,
            };
          }
        });
      console.log(`[SpeakerMatcher] Built ${participants.length} participants from identifiers`);
    }

    if (participants.length === 0) {
      // All participants assigned via speech timeline, mark remaining as unmatched
      for (const speaker of speakers) {
        mapping[speaker.label] = {
          email: null,
          name: `Unknown Speaker (${speaker.label})`,
          confidence: 'none',
          method: 'unmatched',
        };
      }
      return mapping;
    }

    // Heuristic 1: If number of speakers equals participants, do simple 1:1 matching
    if (speakers.length === participants.length) {
      for (let i = 0; i < speakers.length; i++) {
        mapping[speakers[i].label] = {
          email: participants[i].email,
          name: participants[i].name,
          confidence: 'medium',
          method: 'count-match',
        };
      }
      return mapping;
    }

    // Heuristic 2: First speaker is often the meeting organizer
    // (This would require organizer info from calendar, which we'll add later)
    if (speakers.length > 0 && participants.length > 0 && options.includeOrganizer) {
      mapping[speakers[0].label] = {
        email: participants[0].email,
        name: participants[0].name,
        confidence: 'low',
        method: 'first-speaker',
      };
    }

    // Heuristic 3: Most talkative speaker is likely host/organizer
    if (speakers.length > 1 && participants.length > 1) {
      const mostTalkative = speakers[0];
      if (!mapping[mostTalkative.label]) {
        mapping[mostTalkative.label] = {
          email: participants[0].email,
          name: participants[0].name,
          confidence: 'low',
          method: 'most-talkative',
        };
      }
    }

    // Heuristic 4: Map remaining speakers to remaining participants
    const mappedSpeakers = new Set(Object.keys(mapping));
    const mappedEmails = new Set(Object.values(mapping).map(m => m.email));

    const unmappedSpeakers = speakers.filter(s => !mappedSpeakers.has(s.label));
    const unmappedParticipants = participants.filter(p => !mappedEmails.has(p.email));

    for (let i = 0; i < Math.min(unmappedSpeakers.length, unmappedParticipants.length); i++) {
      mapping[unmappedSpeakers[i].label] = {
        email: unmappedParticipants[i].email,
        name: unmappedParticipants[i].name,
        confidence: 'low',
        method: 'sequential',
      };
    }

    // Mark any speakers without matches as "Unknown"
    for (const speaker of speakers) {
      if (!mapping[speaker.label]) {
        mapping[speaker.label] = {
          email: null,
          name: `Unknown Speaker (${speaker.label})`,
          confidence: 'none',
          method: 'unmatched',
        };
      }
    }

    return mapping;
  }

  /**
   * Extract name from email address
   * @param {string} email - Email address
   * @returns {string} Extracted name
   */
  extractNameFromEmail(email) {
    if (!email) return 'Unknown';

    try {
      const localPart = email.split('@')[0];
      // Convert john.doe or john_doe to John Doe
      const name = localPart
        .replace(/[._-]/g, ' ')
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
      return name;
    } catch {
      return 'Unknown';
    }
  }

  /**
   * Apply speaker mapping to transcript
   * @param {Array} transcript - Original transcript with speaker labels
   * @param {Object} speakerMapping - Speaker to participant mapping
   * @returns {Array} Transcript with updated speaker names
   */
  applyMappingToTranscript(transcript, speakerMapping) {
    if (!transcript || !speakerMapping) return transcript;

    return transcript.map(utterance => {
      const speakerInfo = speakerMapping[utterance.speaker];
      if (speakerInfo) {
        return {
          ...utterance,
          speaker: utterance.speaker, // Keep original label
          speakerName: speakerInfo.name, // Add identified name
          speakerEmail: speakerInfo.email,
          speakerConfidence: speakerInfo.confidence,
        };
      }
      return utterance;
    });
  }

  /**
   * Format transcript with speaker names for display
   * @param {Array} transcript - Transcript with speaker mapping applied
   * @param {boolean} useNames - Use speaker names instead of labels
   * @returns {string} Formatted transcript
   */
  formatTranscript(transcript, useNames = true) {
    if (!transcript || transcript.length === 0) return '';

    return transcript
      .map(utterance => {
        const speaker =
          useNames && utterance.speakerName
            ? utterance.speakerName
            : utterance.speaker || 'Unknown';

        const timestamp = this.formatTimestamp(utterance.start);
        const text = utterance.text || '';

        return `[${timestamp}] ${speaker}: ${text}`;
      })
      .join('\n\n');
  }

  /**
   * Format timestamp in MM:SS format
   * @param {number} seconds - Time in seconds
   * @returns {string} Formatted timestamp
   */
  formatTimestamp(seconds) {
    if (!seconds && seconds !== 0) return '00:00';

    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * Get speaker statistics summary
   * @param {Map} speakerStats - Speaker statistics
   * @returns {Array} Array of speaker summaries
   */
  getSpeakerSummary(speakerStats) {
    return Array.from(speakerStats.values())
      .map(stats => ({
        label: stats.label,
        wordCount: stats.wordCount,
        utteranceCount: stats.utteranceCount,
        duration: Math.round(stats.totalDuration),
        participationRate: 0, // Will be calculated if total duration is known
      }))
      .sort((a, b) => b.wordCount - a.wordCount);
  }
}

module.exports = SpeakerMatcher;
