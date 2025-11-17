/**
 * Transcript Parser
 *
 * Parses transcript files in various formats (.txt, .md, .vtt, .srt)
 * and converts them to a standardized format for import into the system.
 *
 * Phase 8 - Import Prior Transcripts
 * Phase 10.8.1 - Pattern Configuration System (refactored to use config patterns)
 */

const fs = require('fs').promises;
const path = require('path');
const patternConfigLoader = require('./PatternConfigLoader');

class TranscriptParser {
  /**
   * Parse a transcript file based on its extension
   * @param {string} filePath - Path to the transcript file
   * @returns {Promise<Object>} Parsed transcript data
   */
  async parseFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const content = await fs.readFile(filePath, 'utf-8');

    switch (ext) {
      case '.txt':
        return await this.parsePlainText(content, filePath);
      case '.md':
        return await this.parseMarkdown(content, filePath);
      case '.vtt':
        return this.parseVTT(content, filePath);
      case '.srt':
        return this.parseSRT(content, filePath);
      default:
        throw new Error(`Unsupported file format: ${ext}`);
    }
  }

  /**
   * Parse plain text transcript
   * Uses configurable patterns from transcript-patterns.yaml
   * Phase 10.8.1 - Refactored to use pattern configuration
   */
  async parsePlainText(content, filePath) {
    // Load patterns and settings from config
    const config = await patternConfigLoader.loadConfig();
    const patterns = await patternConfigLoader.getEnabledPatterns();
    const settings = await patternConfigLoader.getSettings();

    const lines = content.split('\n');
    const entries = [];
    let rawText = '';

    // Pattern for quoted text (regular or curly quotes)
    const quotedTextPattern = /^["″''](.+)["″'']$/;

    let currentSpeaker = settings.defaultSpeaker || 'Unknown';
    let i = 0;

    // Separate patterns by type for efficiency
    const headerPatterns = patterns.filter(p => p.type === 'header');
    const inlinePatterns = patterns.filter(p => p.type === 'inline');
    const timestampPatterns = patterns.filter(p => p.type === 'timestamp');

    while (i < lines.length) {
      const line = lines[i].trim();

      // Skip empty lines if configured
      if (!line && settings.skipEmptyLines) {
        i++;
        continue;
      }

      // Try to match patterns in priority order
      let matched = false;

      // 1. Try header patterns first (highest priority)
      for (const pattern of headerPatterns) {
        const match = line.match(pattern.compiledRegex);
        if (match) {
          // Extract speaker from capture group
          const speakerGroup = pattern.captureGroups.speaker;
          if (speakerGroup && match[speakerGroup]) {
            currentSpeaker = match[speakerGroup].trim();
            i++;

            // Collect text lines for this speaker
            const textLines = [];
            while (i < lines.length) {
              const nextLine = lines[i].trim();

              // Stop at empty line (if configured)
              if (!nextLine && settings.headerStopPatterns?.emptyLine) {
                break;
              }

              // Check if next line matches any stop pattern
              let shouldStop = false;

              // Stop at next speaker header
              if (settings.headerStopPatterns?.nextSpeakerHeader) {
                for (const hp of headerPatterns) {
                  if (nextLine.match(hp.compiledRegex)) {
                    shouldStop = true;
                    break;
                  }
                }
              }

              // Stop at speaker with inline text
              if (!shouldStop && settings.headerStopPatterns?.nextInlineSpeaker) {
                for (const ip of inlinePatterns) {
                  if (nextLine.match(ip.compiledRegex)) {
                    shouldStop = true;
                    break;
                  }
                }
              }

              // Stop at timestamp
              if (!shouldStop && settings.headerStopPatterns?.nextTimestamp) {
                for (const tp of timestampPatterns) {
                  if (nextLine.match(tp.compiledRegex)) {
                    shouldStop = true;
                    break;
                  }
                }
              }

              if (shouldStop) {
                break;
              }

              // Collect this line as text
              let text = nextLine;

              // Remove surrounding quotes if configured
              if (settings.stripQuotes) {
                const quotedMatch = text.match(quotedTextPattern);
                if (quotedMatch) {
                  text = quotedMatch[1];
                }
              }

              textLines.push(text);
              i++;
            }

            // Create entry if we collected any text
            if (textLines.length > 0) {
              const combinedText = textLines.join(' ');
              entries.push({
                speaker: currentSpeaker,
                text: combinedText,
                timestamp: null,
              });
              rawText += `${currentSpeaker}: ${combinedText}\n`;
            }

            matched = true;
            break;
          }
        }
      }

      if (matched) continue;

      // 2. Try inline patterns
      for (const pattern of inlinePatterns) {
        const match = line.match(pattern.compiledRegex);
        if (match) {
          // Extract speaker and text from capture groups
          const speakerGroup = pattern.captureGroups.speaker;
          const textGroup = pattern.captureGroups.text;

          if (speakerGroup && match[speakerGroup]) {
            currentSpeaker = match[speakerGroup].trim();
          }

          let text = textGroup && match[textGroup] ? match[textGroup].trim() : '';

          // Remove quotes if configured
          if (settings.stripQuotes) {
            const quotedMatch = text.match(quotedTextPattern);
            if (quotedMatch) {
              text = quotedMatch[1];
            }
          }

          entries.push({
            speaker: currentSpeaker,
            text: text,
            timestamp: null,
          });
          rawText += `${currentSpeaker}: ${text}\n`;
          i++;
          matched = true;
          break;
        }
      }

      if (matched) continue;

      // 3. Try timestamp patterns
      for (const pattern of timestampPatterns) {
        const match = line.match(pattern.compiledRegex);
        if (match) {
          const timestampGroup = pattern.captureGroups.timestamp;
          const textGroup = pattern.captureGroups.text;

          const timestamp = timestampGroup && match[timestampGroup] ? match[timestampGroup] : null;
          const text = textGroup && match[textGroup] ? match[textGroup].trim() : '';

          entries.push({
            speaker: currentSpeaker,
            text: text,
            timestamp: this.parseTimestamp(timestamp),
          });
          rawText += `${text}\n`;
          i++;
          matched = true;
          break;
        }
      }

      if (matched) continue;

      // 4. Plain text line - attribute to current speaker
      let text = line;

      // Remove quotes if configured
      if (settings.stripQuotes) {
        const quotedMatch = text.match(quotedTextPattern);
        if (quotedMatch) {
          text = quotedMatch[1];
        }
      }

      entries.push({
        speaker: currentSpeaker,
        text: text,
        timestamp: null,
      });
      rawText += `${text}\n`;
      i++;
    }

    return {
      format: 'txt',
      filePath,
      entries,
      rawText: rawText.trim(),
      hasSpeakers: entries.some(e => e.speaker !== settings.defaultSpeaker),
      hasTimestamps: entries.some(e => e.timestamp !== null),
    };
  }

  /**
   * Parse markdown transcript
   * Supports common markdown transcript formats
   * Phase 10.8.1 - Refactored to use pattern configuration
   */
  async parseMarkdown(content, filePath) {
    const lines = content.split('\n');
    const entries = [];
    const rawText = '';
    let metadata = {};

    // Extract YAML frontmatter if present
    if (content.startsWith('---')) {
      const frontmatterEnd = content.indexOf('---', 3);
      if (frontmatterEnd !== -1) {
        const frontmatter = content.substring(3, frontmatterEnd);
        metadata = this.parseYAMLFrontmatter(frontmatter);

        // Process content after frontmatter
        const mainContent = content.substring(frontmatterEnd + 3);
        return await this.parseMarkdownContent(mainContent, filePath, metadata);
      }
    }

    // Parse without frontmatter
    return await this.parseMarkdownContent(content, filePath, metadata);
  }

  async parseMarkdownContent(content, filePath, metadata) {
    // Load patterns and settings from config (same as plain text)
    const config = await patternConfigLoader.loadConfig();
    const patterns = await patternConfigLoader.getEnabledPatterns();
    const settings = await patternConfigLoader.getSettings();

    const lines = content.split('\n');
    const entries = [];
    let rawText = '';

    // Pattern for quoted text (regular or curly quotes)
    const quotedTextPattern = /^["″''](.+)["″'']$/;

    let currentSpeaker = settings.defaultSpeaker || 'Unknown';
    let i = 0;

    // Separate patterns by type for efficiency
    const headerPatterns = patterns.filter(p => p.type === 'header');
    const inlinePatterns = patterns.filter(p => p.type === 'inline');
    const timestampPatterns = patterns.filter(p => p.type === 'timestamp');

    while (i < lines.length) {
      const line = lines[i].trim();

      // Skip empty lines if configured
      if (!line && settings.skipEmptyLines) {
        i++;
        continue;
      }

      // Skip HTML comments
      if (line.startsWith('<!--')) {
        i++;
        continue;
      }

      // Try to match patterns in priority order
      let matched = false;

      // 1. Try header patterns first (highest priority)
      for (const pattern of headerPatterns) {
        const match = line.match(pattern.compiledRegex);
        if (match) {
          // Extract speaker from capture group
          const speakerGroup = pattern.captureGroups.speaker;
          if (speakerGroup && match[speakerGroup]) {
            currentSpeaker = match[speakerGroup].trim();
            i++;

            // For markdown headings (##), just set speaker and continue
            if (line.startsWith('#')) {
              matched = true;
              break;
            }

            // Collect text lines for this speaker (non-markdown header patterns)
            const textLines = [];
            while (i < lines.length) {
              const nextLine = lines[i].trim();

              // Stop at empty line (if configured)
              if (!nextLine && settings.headerStopPatterns?.emptyLine) {
                break;
              }

              // Stop at HTML comments
              if (nextLine.startsWith('<!--')) {
                break;
              }

              // Check if next line matches any stop pattern
              let shouldStop = false;

              // Stop at next speaker header
              if (settings.headerStopPatterns?.nextSpeakerHeader) {
                for (const hp of headerPatterns) {
                  if (nextLine.match(hp.compiledRegex)) {
                    shouldStop = true;
                    break;
                  }
                }
              }

              // Stop at speaker with inline text
              if (!shouldStop && settings.headerStopPatterns?.nextInlineSpeaker) {
                for (const ip of inlinePatterns) {
                  if (nextLine.match(ip.compiledRegex)) {
                    shouldStop = true;
                    break;
                  }
                }
              }

              // Stop at timestamp
              if (!shouldStop && settings.headerStopPatterns?.nextTimestamp) {
                for (const tp of timestampPatterns) {
                  if (nextLine.match(tp.compiledRegex)) {
                    shouldStop = true;
                    break;
                  }
                }
              }

              if (shouldStop) {
                break;
              }

              // Collect this line as text
              let text = nextLine;

              // Remove surrounding quotes if configured
              if (settings.stripQuotes) {
                const quotedMatch = text.match(quotedTextPattern);
                if (quotedMatch) {
                  text = quotedMatch[1];
                }
              }

              textLines.push(text);
              i++;
            }

            // Create entry if we collected any text
            if (textLines.length > 0) {
              const combinedText = textLines.join(' ');
              entries.push({
                speaker: currentSpeaker,
                text: combinedText,
                timestamp: null,
              });
              rawText += `${currentSpeaker}: ${combinedText}\n`;
            }

            matched = true;
            break;
          }
        }
      }

      if (matched) continue;

      // 2. Try inline patterns
      for (const pattern of inlinePatterns) {
        const match = line.match(pattern.compiledRegex);
        if (match) {
          // Extract speaker and text from capture groups
          const speakerGroup = pattern.captureGroups.speaker;
          const textGroup = pattern.captureGroups.text;

          if (speakerGroup && match[speakerGroup]) {
            currentSpeaker = match[speakerGroup].trim();
          }

          let text = textGroup && match[textGroup] ? match[textGroup].trim() : '';

          // Remove quotes if configured
          if (settings.stripQuotes) {
            const quotedMatch = text.match(quotedTextPattern);
            if (quotedMatch) {
              text = quotedMatch[1];
            }
          }

          entries.push({
            speaker: currentSpeaker,
            text: text,
            timestamp: null,
          });
          rawText += `${currentSpeaker}: ${text}\n`;
          i++;
          matched = true;
          break;
        }
      }

      if (matched) continue;

      // 3. Try timestamp patterns
      for (const pattern of timestampPatterns) {
        const match = line.match(pattern.compiledRegex);
        if (match) {
          const timestampGroup = pattern.captureGroups.timestamp;
          const textGroup = pattern.captureGroups.text;

          const timestamp = timestampGroup && match[timestampGroup] ? match[timestampGroup] : null;
          const text = textGroup && match[textGroup] ? match[textGroup].trim() : '';

          entries.push({
            speaker: currentSpeaker,
            text: text,
            timestamp: this.parseTimestamp(timestamp),
          });
          rawText += `${text}\n`;
          i++;
          matched = true;
          break;
        }
      }

      if (matched) continue;

      // 4. Plain text line - attribute to current speaker
      let text = line;

      // Remove quotes if configured
      if (settings.stripQuotes) {
        const quotedMatch = text.match(quotedTextPattern);
        if (quotedMatch) {
          text = quotedMatch[1];
        }
      }

      entries.push({
        speaker: currentSpeaker,
        text: text,
        timestamp: null,
      });
      rawText += `${text}\n`;
      i++;
    }

    return {
      format: 'md',
      filePath,
      entries,
      rawText: rawText.trim(),
      metadata,
      hasSpeakers: entries.some(e => e.speaker !== settings.defaultSpeaker),
      hasTimestamps: entries.some(e => e.timestamp !== null),
    };
  }

  /**
   * Parse WebVTT (Web Video Text Tracks) format
   * Standard format for video subtitles/captions
   */
  parseVTT(content, filePath) {
    const lines = content.split('\n');
    const entries = [];
    let rawText = '';

    // VTT format:
    // WEBVTT
    //
    // 00:00:00.000 --> 00:00:05.000
    // Speaker: This is the first line
    //
    // 00:00:05.000 --> 00:00:10.000
    // Another speaker: This is the second line

    let i = 0;

    // Skip header
    if (lines[i].startsWith('WEBVTT')) {
      i++;
    }

    while (i < lines.length) {
      const line = lines[i].trim();

      if (!line) {
        i++;
        continue;
      }

      // Check for timestamp line (e.g., "00:00:00.000 --> 00:00:05.000")
      const timestampMatch = line.match(
        /^(\d{2}:\d{2}:\d{2}\.\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2}\.\d{3})/
      );

      if (timestampMatch) {
        const startTime = timestampMatch[1];
        i++;

        // Collect all text lines until we hit a blank line or another timestamp
        const textLines = [];
        while (i < lines.length && lines[i].trim() && !lines[i].match(/-->/)) {
          textLines.push(lines[i].trim());
          i++;
        }

        const fullText = textLines.join(' ');

        // Try to extract speaker from text (e.g., "Speaker: text")
        const speakerMatch = fullText.match(/^([^:]+):\s*(.+)/);

        if (speakerMatch) {
          entries.push({
            speaker: speakerMatch[1].trim(),
            text: speakerMatch[2].trim(),
            timestamp: this.parseTimestamp(startTime),
          });
          rawText += `${speakerMatch[2].trim()}\n`;
        } else {
          entries.push({
            speaker: 'Unknown',
            text: fullText,
            timestamp: this.parseTimestamp(startTime),
          });
          rawText += `${fullText}\n`;
        }
      } else {
        i++;
      }
    }

    return {
      format: 'vtt',
      filePath,
      entries,
      rawText: rawText.trim(),
      hasSpeakers: entries.some(e => e.speaker !== 'Unknown'),
      hasTimestamps: true,
    };
  }

  /**
   * Parse SRT (SubRip) format
   * Common subtitle format
   */
  parseSRT(content, filePath) {
    const lines = content.split('\n');
    const entries = [];
    let rawText = '';

    // SRT format:
    // 1
    // 00:00:00,000 --> 00:00:05,000
    // Speaker: This is the first line
    //
    // 2
    // 00:00:05,000 --> 00:00:10,000
    // Another speaker: This is the second line

    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();

      if (!line) {
        i++;
        continue;
      }

      // Check for sequence number
      if (/^\d+$/.test(line)) {
        i++; // Skip sequence number

        // Next line should be timestamp
        const timestampLine = lines[i];
        const timestampMatch = timestampLine?.match(
          /^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/
        );

        if (timestampMatch) {
          const startTime = timestampMatch[1].replace(',', '.');
          i++;

          // Collect all text lines until we hit a blank line
          const textLines = [];
          while (i < lines.length && lines[i].trim()) {
            textLines.push(lines[i].trim());
            i++;
          }

          const fullText = textLines.join(' ');

          // Try to extract speaker from text
          const speakerMatch = fullText.match(/^([^:]+):\s*(.+)/);

          if (speakerMatch) {
            entries.push({
              speaker: speakerMatch[1].trim(),
              text: speakerMatch[2].trim(),
              timestamp: this.parseTimestamp(startTime),
            });
            rawText += `${speakerMatch[2].trim()}\n`;
          } else {
            entries.push({
              speaker: 'Unknown',
              text: fullText,
              timestamp: this.parseTimestamp(startTime),
            });
            rawText += `${fullText}\n`;
          }
        } else {
          i++;
        }
      } else {
        i++;
      }
    }

    return {
      format: 'srt',
      filePath,
      entries,
      rawText: rawText.trim(),
      hasSpeakers: entries.some(e => e.speaker !== 'Unknown'),
      hasTimestamps: true,
    };
  }

  /**
   * Parse timestamp string to seconds
   * Supports formats: HH:MM:SS, MM:SS, HH:MM:SS.mmm
   */
  parseTimestamp(timeStr) {
    if (!timeStr) return null;

    const parts = timeStr.split(':');
    let hours = 0,
      minutes = 0,
      seconds = 0;

    if (parts.length === 3) {
      // HH:MM:SS or HH:MM:SS.mmm
      hours = parseInt(parts[0]);
      minutes = parseInt(parts[1]);
      seconds = parseFloat(parts[2]);
    } else if (parts.length === 2) {
      // MM:SS
      minutes = parseInt(parts[0]);
      seconds = parseFloat(parts[1]);
    } else {
      return null;
    }

    return hours * 3600 + minutes * 60 + seconds;
  }

  /**
   * Parse simple YAML frontmatter
   * (Basic implementation - doesn't handle complex YAML)
   */
  parseYAMLFrontmatter(yaml) {
    const metadata = {};
    const lines = yaml.split('\n');

    for (const line of lines) {
      const match = line.match(/^([^:]+):\s*(.+)/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim();

        // Remove quotes if present
        metadata[key] = value.replace(/^["']|["']$/g, '');
      }
    }

    return metadata;
  }

  /**
   * Get unique speakers from parsed transcript
   */
  getSpeakers(parsedData) {
    const speakers = new Set();

    for (const entry of parsedData.entries) {
      if (entry.speaker && entry.speaker !== 'Unknown') {
        speakers.add(entry.speaker);
      }
    }

    return Array.from(speakers);
  }

  /**
   * Convert parsed data to the format expected by the meeting system
   * Returns array of transcript entries with speaker, text, and timestamp
   */
  toMeetingTranscript(parsedData) {
    // Return entries in the simple format expected by Zod schema
    return parsedData.entries.map(entry => ({
      speaker: entry.speaker || 'Unknown',
      text: entry.text || '',
      timestamp: entry.timestamp,
    }));
  }
}

module.exports = TranscriptParser;
