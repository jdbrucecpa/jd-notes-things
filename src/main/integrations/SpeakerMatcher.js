/**
 * SpeakerMatcher - Matches diarized speakers to meeting participants
 * Phase 6: Speaker Recognition & Contact Matching
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
   * @returns {Object} Speaker mapping (speakerLabel -> participant info)
   */
  async matchSpeakers(transcript, participantEmails, options = {}) {
    const {
      includeOrganizer = true,
      useWordCount = true,
      useTimingHeuristics = true
    } = options;

    if (!transcript || transcript.length === 0) {
      console.log('[SpeakerMatcher] Empty transcript - no speakers to match');
      return {};
    }

    if (!participantEmails || participantEmails.length === 0) {
      console.log('[SpeakerMatcher] No participants - cannot match speakers');
      return {};
    }

    console.log(`[SpeakerMatcher] Matching ${this.getSpeakerCount(transcript)} speakers to ${participantEmails.length} participants`);

    // Step 1: Get contact information for all participants
    const contacts = await this.googleContacts.findContactsByEmails(participantEmails);
    console.log(`[SpeakerMatcher] Found ${contacts.size} contacts out of ${participantEmails.length} participants`);

    // Step 2: Analyze speakers in transcript
    const speakerStats = this.analyzeSpeakers(transcript);

    // Step 3: Match speakers to participants using heuristics
    const speakerMapping = this.createSpeakerMapping(speakerStats, participantEmails, contacts, options);

    console.log('[SpeakerMatcher] Speaker matching complete:', speakerMapping);
    return speakerMapping;
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
          totalDuration: 0
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
   * @param {Array} participantEmails - Participant emails
   * @param {Map} contacts - Contact information
   * @param {Object} options - Matching options
   * @returns {Object} Speaker mapping
   */
  createSpeakerMapping(speakerStats, participantEmails, contacts, options) {
    const mapping = {};

    // Convert speaker stats to array and sort by word count (most talkative first)
    const speakers = Array.from(speakerStats.values())
      .sort((a, b) => b.wordCount - a.wordCount);

    // Create participant list with contact info
    const participants = participantEmails.map(email => {
      const contact = contacts.get(email);
      return {
        email,
        name: contact?.name || this.extractNameFromEmail(email),
        givenName: contact?.givenName || '',
        familyName: contact?.familyName || '',
        contact: contact
      };
    });

    // Heuristic 1: If number of speakers equals participants, do simple 1:1 matching
    if (speakers.length === participants.length) {
      for (let i = 0; i < speakers.length; i++) {
        mapping[speakers[i].label] = {
          email: participants[i].email,
          name: participants[i].name,
          confidence: 'medium',
          method: 'count-match'
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
        method: 'first-speaker'
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
          method: 'most-talkative'
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
        method: 'sequential'
      };
    }

    // Mark any speakers without matches as "Unknown"
    for (const speaker of speakers) {
      if (!mapping[speaker.label]) {
        mapping[speaker.label] = {
          email: null,
          name: `Unknown Speaker (${speaker.label})`,
          confidence: 'none',
          method: 'unmatched'
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
    } catch (error) {
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
          speakerConfidence: speakerInfo.confidence
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

    return transcript.map(utterance => {
      const speaker = useNames && utterance.speakerName
        ? utterance.speakerName
        : utterance.speaker || 'Unknown';

      const timestamp = this.formatTimestamp(utterance.start);
      const text = utterance.text || '';

      return `[${timestamp}] ${speaker}: ${text}`;
    }).join('\n\n');
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
    return Array.from(speakerStats.values()).map(stats => ({
      label: stats.label,
      wordCount: stats.wordCount,
      utteranceCount: stats.utteranceCount,
      duration: Math.round(stats.totalDuration),
      participationRate: 0 // Will be calculated if total duration is known
    })).sort((a, b) => b.wordCount - a.wordCount);
  }
}

module.exports = SpeakerMatcher;
