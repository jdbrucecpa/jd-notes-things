/**
 * Metadata Extractor
 *
 * Extracts meeting metadata (date, title, participants) from
 * filenames and transcript content.
 *
 * Phase 8 - Import Prior Transcripts
 * Enhanced for v1.1 (IM-2): Added file modification time fallback
 */

const path = require('path');
const fs = require('fs');

class MetadataExtractor {
  /**
   * Extract all metadata from a parsed transcript file
   * @param {Object} parsedData - Parsed transcript data from TranscriptParser
   * @param {string} filePath - Original file path
   * @returns {Object} Extracted metadata
   */
  extractMetadata(parsedData, filePath) {
    const filename = path.basename(filePath, path.extname(filePath));

    // Extract from filename first
    const dateFromFilename = this.extractDateFromFilename(filename);
    const titleFromFilename = this.extractTitleFromFilename(filename, dateFromFilename);
    const titleFromFolder = this.extractTitleFromFolderName(filePath);

    // Extract from content
    const dateFromContent = this.extractDateFromContent(parsedData);
    const titleFromContent = this.extractTitleFromContent(parsedData);
    const participantsFromContent = this.extractParticipants(parsedData);
    const participantsFromFolder = this.extractParticipantsFromFolderName(filePath);
    const emails = this.extractEmails(parsedData);
    const platform = this.detectPlatform(parsedData);
    const duration = this.estimateDuration(parsedData);

    // Merge participants: folder names take priority (more reliable for Krisp exports)
    // Use Set to deduplicate
    const allParticipants = new Set([...participantsFromFolder, ...participantsFromContent]);
    const participants = Array.from(allParticipants);

    // Get file modification time as fallback (IM-2.3)
    const dateFromFile = this.extractDateFromFileStats(filePath);

    // Prioritize: filename > content > file modification time > today
    let finalDate;
    let dateConfidence;
    if (dateFromFilename) {
      finalDate = dateFromFilename;
      dateConfidence = 'high';
    } else if (dateFromContent) {
      finalDate = dateFromContent;
      dateConfidence = 'medium';
    } else if (dateFromFile) {
      finalDate = dateFromFile;
      dateConfidence = 'low'; // File modification time is least reliable
    } else {
      finalDate = new Date();
      dateConfidence = 'none'; // Using today's date as last resort
    }

    const finalTitle =
      titleFromFilename || titleFromFolder || titleFromContent || 'Imported Meeting';

    return {
      date: finalDate,
      title: finalTitle,
      participants,
      participantEmails: emails,
      platform,
      duration,
      source: 'import',
      importedFrom: path.basename(filePath),
      // Add status for review queue (IM-2.5)
      status: 'needs_verification',
      confidence: {
        date: dateConfidence,
        dateSource: dateFromFilename
          ? 'filename'
          : dateFromContent
            ? 'content'
            : dateFromFile
              ? 'file_mtime'
              : 'default',
        title: titleFromFilename
          ? 'high'
          : titleFromFolder
            ? 'high'
            : titleFromContent
              ? 'medium'
              : 'low',
        titleSource: titleFromFilename
          ? 'filename'
          : titleFromFolder
            ? 'folder'
            : titleFromContent
              ? 'content'
              : 'default',
        participants: participants.length > 0 ? 'high' : 'low',
        participantsSource:
          participantsFromFolder.length > 0
            ? 'folder'
            : participantsFromContent.length > 0
              ? 'content'
              : 'none',
      },
    };
  }

  /**
   * Extract date from file modification time (IM-2.3)
   * Used as fallback when date cannot be extracted from filename or content
   * @param {string} filePath - Path to the file
   * @returns {Date|null} File modification date or null
   */
  extractDateFromFileStats(filePath) {
    try {
      const stats = fs.statSync(filePath);
      if (stats && stats.mtime) {
        // Use modification time, not creation time (more reliable across OS)
        return stats.mtime;
      }
    } catch (error) {
      console.warn(`[MetadataExtractor] Could not read file stats for ${filePath}:`, error.message);
    }
    return null;
  }

  /**
   * Extract date from filename
   * Supports formats:
   * - YYYY-MM-DD
   * - YYYY_MM_DD
   * - MM-DD-YYYY
   * - DD-MM-YYYY (if ambiguous, assumes US format)
   */
  extractDateFromFilename(filename) {
    // Try ISO format (YYYY-MM-DD or YYYY_MM_DD)
    const isoMatch = filename.match(/(\d{4})[-_](\d{1,2})[-_](\d{1,2})/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    // Try US format (MM-DD-YYYY or MM_DD_YYYY)
    const usMatch = filename.match(/(\d{1,2})[-_](\d{1,2})[-_](\d{4})/);
    if (usMatch) {
      const [, month, day, year] = usMatch;
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }

    // Try short format (YYYYMMDD)
    const shortMatch = filename.match(/(\d{8})/);
    if (shortMatch) {
      const dateStr = shortMatch[1];
      const year = parseInt(dateStr.substring(0, 4));
      const month = parseInt(dateStr.substring(4, 6));
      const day = parseInt(dateStr.substring(6, 8));

      if (year > 1900 && year < 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return new Date(year, month - 1, day);
      }
    }

    return null;
  }

  /**
   * Extract title from filename
   * Removes date portions and file extensions
   */
  extractTitleFromFilename(filename, _dateObj) {
    let title = filename;

    // Remove common date patterns
    title = title.replace(/\d{4}[-_]\d{1,2}[-_]\d{1,2}/g, '');
    title = title.replace(/\d{1,2}[-_]\d{1,2}[-_]\d{4}/g, '');
    title = title.replace(/\d{8}/g, '');

    // Remove common separators at start/end
    title = title.replace(/^[-_\s]+|[-_\s]+$/g, '');

    // Replace separators with spaces
    title = title.replace(/[-_]+/g, ' ');

    // Capitalize first letter of each word
    title = title.replace(/\b\w/g, char => char.toUpperCase());

    // If title is empty or too short, use a default
    if (!title || title.length < 3) {
      return null;
    }

    return title;
  }

  /**
   * Extract title from parent folder name
   * Supports Krisp format: "Name1 and Name2-<hash>" -> "Name1 and Name2"
   * @param {string} filePath - Path to the transcript file
   * @returns {string|null} Title from folder name or null
   */
  extractTitleFromFolderName(filePath) {
    try {
      const parentDir = path.dirname(filePath);
      const folderName = path.basename(parentDir);

      // Skip generic folder names
      if (
        folderName === 'transcript-to-import' ||
        folderName === 'imports' ||
        folderName === '.' ||
        folderName.toLowerCase() === 'transcripts'
      ) {
        return null;
      }

      // Remove Krisp-style hash suffix: "Name1 and Name2-<hash>"
      const krispPattern = /^(.+)-[a-f0-9]{20,}$/i;
      const match = folderName.match(krispPattern);

      if (match) {
        const title = match[1].trim();
        if (title.length >= 3) {
          console.log(`[MetadataExtractor] Extracted title from folder name: ${title}`);
          return title;
        }
      }

      // Use folder name as-is if it's not a generic name
      if (folderName.length >= 3) {
        return folderName;
      }
    } catch (error) {
      console.warn('[MetadataExtractor] Error extracting title from folder:', error.message);
    }

    return null;
  }

  /**
   * Extract date from content
   * Looks for date mentions in the text or metadata
   */
  extractDateFromContent(parsedData) {
    // Check metadata first (from frontmatter)
    if (parsedData.metadata) {
      const dateFields = ['date', 'meeting_date', 'meetingDate', 'created', 'timestamp'];

      for (const field of dateFields) {
        if (parsedData.metadata[field]) {
          const date = new Date(parsedData.metadata[field]);
          if (!isNaN(date.getTime())) {
            return date;
          }
        }
      }
    }

    // Look for date mentions in the first few lines of text
    const firstLines = parsedData.rawText.split('\n').slice(0, 10).join('\n');

    // Match patterns like "January 15, 2025" or "15 Jan 2025"
    const longDateMatch = firstLines.match(
      /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i
    );
    if (longDateMatch) {
      const date = new Date(longDateMatch[0]);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    // Match "Meeting on YYYY-MM-DD" or similar
    const dateContextMatch = firstLines.match(
      /(?:on|date:|meeting:)\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/i
    );
    if (dateContextMatch) {
      const date = new Date(dateContextMatch[1]);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  }

  /**
   * Extract title from content
   * Looks for title in metadata or first heading
   */
  extractTitleFromContent(parsedData) {
    // Check metadata first
    if (parsedData.metadata) {
      const titleFields = ['title', 'meeting_title', 'meetingTitle', 'subject', 'name'];

      for (const field of titleFields) {
        if (parsedData.metadata[field]) {
          return parsedData.metadata[field];
        }
      }
    }

    // Look for markdown headings in first few lines
    const lines = parsedData.rawText.split('\n');

    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i].trim();

      // Match markdown headings (# Title or ## Title)
      const headingMatch = line.match(/^#{1,2}\s+(.+)/);
      if (headingMatch) {
        return headingMatch[1].trim();
      }

      // Match "Title:" or "Subject:" lines
      const labelMatch = line.match(/^(?:Title|Subject|Meeting):\s*(.+)/i);
      if (labelMatch) {
        return labelMatch[1].trim();
      }
    }

    return null;
  }

  /**
   * Extract participant names from transcript
   */
  extractParticipants(parsedData) {
    const participants = new Set();

    // Non-dialogue labels that should not be treated as participants
    const nonDialogueLabels = ['Unknown', 'Speaker', 'Transcript', 'Meeting', 'Note', 'Summary'];

    // Get speakers from entries
    for (const entry of parsedData.entries) {
      if (entry.speaker && !nonDialogueLabels.includes(entry.speaker)) {
        participants.add(entry.speaker);
      }
    }

    // Also check metadata
    if (parsedData.metadata) {
      const participantFields = ['participants', 'attendees', 'people'];

      for (const field of participantFields) {
        if (parsedData.metadata[field]) {
          const value = parsedData.metadata[field];

          // Handle array or comma-separated string
          if (Array.isArray(value)) {
            value.forEach(p => participants.add(p));
          } else if (typeof value === 'string') {
            value.split(/[,;]/).forEach(p => participants.add(p.trim()));
          }
        }
      }
    }

    // Fallback: If no participants found, search raw text for speaker patterns
    if (participants.size === 0 && parsedData.rawText) {
      const lines = parsedData.rawText.split('\n');
      const speakerPattern = /^([A-Z][a-zA-Z\s]{1,30}):\s*$/; // Match "Name:" on its own line
      const speakerPattern2 = /^([A-Z][a-zA-Z\s]{1,30}):\s*["″]/; // Match "Name: "quote

      for (const line of lines) {
        const trimmed = line.trim();
        const match = trimmed.match(speakerPattern) || trimmed.match(speakerPattern2);

        if (match) {
          const speaker = match[1].trim();
          // Filter out common false positives
          if (
            speaker.length > 1 &&
            !['Unknown', 'Speaker', 'Transcript', 'Meeting', 'Note', 'Summary'].includes(speaker)
          ) {
            participants.add(speaker);
          }
        }
      }
    }

    return Array.from(participants);
  }

  /**
   * Extract participant names from parent folder name
   * Supports Krisp export format: "Name1 and Name2-<hash>"
   * @param {string} filePath - Path to the transcript file
   * @returns {Array<string>} Array of participant names from folder
   */
  extractParticipantsFromFolderName(filePath) {
    const participants = [];

    try {
      // Get the parent folder name
      const parentDir = path.dirname(filePath);
      const folderName = path.basename(parentDir);

      // Skip if it's a root-level import folder
      if (folderName === 'transcript-to-import' || folderName === 'imports' || folderName === '.') {
        return participants;
      }

      // Pattern for Krisp format: "Name1 and Name2-<hash>"
      // Hash is typically 32 hex characters at the end
      const krispPattern = /^(.+)-[a-f0-9]{20,}$/i;
      const match = folderName.match(krispPattern);

      if (match) {
        const namesSection = match[1];

        // Split by " and " to get individual names
        // Handle multiple participants: "Name1 and Name2 and Name3"
        const names = namesSection.split(/\s+and\s+/i);

        for (const name of names) {
          const trimmedName = name.trim();
          if (trimmedName.length > 1) {
            participants.push(trimmedName);
          }
        }

        if (participants.length > 0) {
          console.log(
            `[MetadataExtractor] Extracted ${participants.length} participants from folder name: ${participants.join(', ')}`
          );
        }
      } else {
        // Try simpler pattern without hash: "Name1 and Name2"
        if (folderName.includes(' and ')) {
          const names = folderName.split(/\s+and\s+/i);
          for (const name of names) {
            const trimmedName = name.trim();
            if (trimmedName.length > 1) {
              participants.push(trimmedName);
            }
          }

          if (participants.length > 0) {
            console.log(
              `[MetadataExtractor] Extracted ${participants.length} participants from folder name (no hash): ${participants.join(', ')}`
            );
          }
        }
      }
    } catch (error) {
      console.warn('[MetadataExtractor] Error extracting participants from folder:', error.message);
    }

    return participants;
  }

  /**
   * Extract email addresses from content
   */
  extractEmails(parsedData) {
    const emails = new Set();
    const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

    // Check metadata first
    if (parsedData.metadata) {
      const metadataStr = JSON.stringify(parsedData.metadata);
      const metadataEmails = metadataStr.match(emailPattern);
      if (metadataEmails) {
        metadataEmails.forEach(email => emails.add(email.toLowerCase()));
      }
    }

    // Check raw text
    const contentEmails = parsedData.rawText.match(emailPattern);
    if (contentEmails) {
      contentEmails.forEach(email => emails.add(email.toLowerCase()));
    }

    return Array.from(emails);
  }

  /**
   * Detect meeting platform from content
   */
  detectPlatform(parsedData) {
    const allText = (parsedData.rawText + JSON.stringify(parsedData.metadata || {})).toLowerCase();

    // Check for platform mentions
    if (allText.includes('zoom') || allText.includes('zoom.us')) {
      return 'zoom';
    }
    if (allText.includes('teams') || allText.includes('microsoft teams')) {
      return 'teams';
    }
    if (allText.includes('meet.google') || allText.includes('google meet')) {
      return 'meet';
    }
    if (allText.includes('webex')) {
      return 'webex';
    }
    if (allText.includes('whereby')) {
      return 'whereby';
    }
    if (allText.includes('skype')) {
      return 'skype';
    }

    return null;
  }

  /**
   * Estimate meeting duration from timestamps
   */
  estimateDuration(parsedData) {
    if (!parsedData.hasTimestamps) {
      return null;
    }

    const timestamps = parsedData.entries.map(e => e.timestamp).filter(t => t !== null);

    if (timestamps.length === 0) {
      return null;
    }

    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);

    return Math.round(maxTime - minTime); // Duration in seconds
  }

  /**
   * Format duration in seconds to human-readable string
   */
  formatDuration(seconds) {
    if (!seconds) return null;

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  /**
   * Validate extracted metadata
   * Returns validation errors if any
   */
  validateMetadata(metadata) {
    const errors = [];

    // Check date
    if (!metadata.date || isNaN(metadata.date.getTime())) {
      errors.push('Invalid or missing date');
    } else {
      const year = metadata.date.getFullYear();
      if (year < 1900 || year > new Date().getFullYear() + 1) {
        errors.push('Date is outside reasonable range');
      }
    }

    // Check title
    if (!metadata.title || metadata.title.length < 3) {
      errors.push('Title is too short or missing');
    }

    // Warnings for low confidence
    if (metadata.confidence.date === 'low') {
      errors.push('Date confidence is low - please verify');
    }

    if (metadata.confidence.title === 'low') {
      errors.push('Title confidence is low - please verify');
    }

    if (metadata.participants.length === 0) {
      errors.push('No participants detected');
    }

    return errors;
  }
}

module.exports = MetadataExtractor;
