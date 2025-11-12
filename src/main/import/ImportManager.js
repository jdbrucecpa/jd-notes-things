/**
 * Import Manager
 *
 * Orchestrates the import process for transcript files.
 * Handles parsing, metadata extraction, meeting creation,
 * routing, and optional summary generation.
 *
 * Phase 8 - Import Prior Transcripts
 */

const TranscriptParser = require('./TranscriptParser');
const MetadataExtractor = require('./MetadataExtractor');
const path = require('path');

class ImportManager {
  constructor({ routingEngine, llmService, vaultStructure, fileOperationManager, templateManager, exportFunction, summaryFunction, autoSummaryFunction }) {
    this.parser = new TranscriptParser();
    this.extractor = new MetadataExtractor();
    this.routingEngine = routingEngine;
    this.llmService = llmService;
    this.vaultStructure = vaultStructure;
    this.fileOperationManager = fileOperationManager;
    this.templateManager = templateManager;
    this.exportFunction = exportFunction;
    this.summaryFunction = summaryFunction;
    this.autoSummaryFunction = autoSummaryFunction;
  }

  /**
   * Import a single transcript file
   * @param {string} filePath - Path to the transcript file
   * @param {Object} options - Import options
   * @returns {Promise<Object>} Import result with meeting data
   */
  async importFile(filePath, options = {}) {
    const {
      generateSummary = false,
      autoExport = false,
      onProgress = null
    } = options;

    try {
      // Step 1: Parse the file
      if (onProgress) onProgress({ step: 'parsing', file: path.basename(filePath) });
      const parsedData = await this.parser.parseFile(filePath);

      // Step 2: Extract metadata
      if (onProgress) onProgress({ step: 'extracting-metadata', file: path.basename(filePath) });
      const metadata = this.extractor.extractMetadata(parsedData, filePath);

      // Step 3: Validate metadata
      const validationErrors = this.extractor.validateMetadata(metadata);
      if (validationErrors.length > 0) {
        console.warn('Metadata validation warnings:', validationErrors);
      }

      // Step 4: Create meeting object
      if (onProgress) onProgress({ step: 'creating-meeting', file: path.basename(filePath) });
      const meeting = await this.createMeeting(parsedData, metadata);

      // Step 5: Generate auto-summary (optional)
      if (generateSummary && meeting.transcript && meeting.transcript.length > 0) {
        if (onProgress) onProgress({ step: 'generating-auto-summary', file: path.basename(filePath) });
        await this.generateSummary(meeting);
      }

      // Step 6: Generate template-based summaries (optional)
      if (generateSummary && this.templateManager && meeting.transcript && meeting.transcript.length > 0) {
        if (onProgress) onProgress({ step: 'generating-template-summaries', file: path.basename(filePath) });
        await this.generateTemplateSummaries(meeting);
      }

      // Step 7: Export to Obsidian (optional)
      if (autoExport) {
        if (onProgress) onProgress({ step: 'exporting', file: path.basename(filePath) });
        await this.exportToObsidian(meeting);
      }

      // Step 7: Save to meetings.json
      if (onProgress) onProgress({ step: 'saving', file: path.basename(filePath) });

      return {
        success: true,
        meeting,
        metadata,
        validationErrors
      };
    } catch (error) {
      console.error(`Error importing ${filePath}:`, error);
      return {
        success: false,
        error: error.message,
        file: filePath
      };
    }
  }

  /**
   * Import multiple files in batch
   * @param {Array<string>} filePaths - Array of file paths
   * @param {Object} options - Import options
   * @returns {Promise<Object>} Batch import results
   */
  async importBatch(filePaths, options = {}) {
    const results = {
      total: filePaths.length,
      successful: 0,
      failed: 0,
      meetings: [],
      errors: []
    };

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];

      // Update progress
      if (options.onProgress) {
        options.onProgress({
          step: 'batch-progress',
          current: i + 1,
          total: filePaths.length,
          file: path.basename(filePath)
        });
      }

      const result = await this.importFile(filePath, options);

      if (result.success) {
        results.successful++;
        results.meetings.push(result.meeting);
      } else {
        results.failed++;
        results.errors.push({
          file: filePath,
          error: result.error
        });
      }
    }

    return results;
  }

  /**
   * Create a meeting object from parsed data and metadata
   */
  async createMeeting(parsedData, metadata) {
    const meetingId = 'imported-' + Date.now();

    // Convert parsed transcript to meeting format
    const transcript = this.parser.toMeetingTranscript(parsedData);

    // Create basic meeting content from transcript
    const content = this.createBasicContent(metadata, parsedData);

    // Extract participant emails for routing
    const participantEmails = metadata.participantEmails || [];

    const meeting = {
      id: meetingId,
      type: 'document', // Changed from 'imported' to match Zod schema
      title: metadata.title,
      date: metadata.date.toISOString(),
      participants: metadata.participants.map(name => ({
        name,
        email: null // Will be populated if found in content
      })),
      participantEmails,
      transcript,
      content,
      platform: metadata.platform || 'unknown', // Changed from null to string
      duration: metadata.duration || null,
      source: 'import',
      importedFrom: metadata.importedFrom,
      importedAt: new Date().toISOString(),
      metadata: {
        originalFormat: parsedData.format,
        hasSpeakers: parsedData.hasSpeakers,
        hasTimestamps: parsedData.hasTimestamps,
        confidence: metadata.confidence
      }
    };

    // Match emails to participants if available
    if (participantEmails.length > 0 && metadata.participants.length > 0) {
      // Simple heuristic: if number of emails matches participants, associate them
      if (participantEmails.length === metadata.participants.length) {
        meeting.participants.forEach((p, idx) => {
          if (participantEmails[idx]) {
            p.email = participantEmails[idx];
          }
        });
      }
    }

    return meeting;
  }

  /**
   * Create basic meeting content from metadata and transcript
   */
  createBasicContent(metadata, parsedData) {
    let content = `# Meeting: ${metadata.title}\n\n`;
    content += `**Date:** ${metadata.date.toLocaleDateString()}\n\n`;

    if (metadata.participants.length > 0) {
      content += `**Participants:**\n`;
      metadata.participants.forEach(p => {
        content += `- ${p}\n`;
      });
      content += '\n';
    }

    if (metadata.platform) {
      content += `**Platform:** ${metadata.platform}\n\n`;
    }

    if (metadata.duration) {
      content += `**Duration:** ${this.extractor.formatDuration(metadata.duration)}\n\n`;
    }

    content += `**Source:** Imported from ${metadata.importedFrom}\n\n`;

    content += `---\n\n`;
    content += `## Transcript Summary\n\n`;
    content += `This meeting was imported from an external transcript file. `;
    content += `The full transcript is available below.\n\n`;

    // Add first few lines as preview
    const lines = parsedData.rawText.split('\n').slice(0, 5);
    content += `**Preview:**\n`;
    lines.forEach(line => {
      if (line.trim()) {
        content += `> ${line}\n`;
      }
    });

    return content;
  }

  /**
   * Generate template-based summaries for imported meeting using shared function
   */
  async generateTemplateSummaries(meeting) {
    if (!this.summaryFunction) {
      console.warn('[Import] Summary function not available');
      return;
    }

    if (!meeting.transcript) {
      console.warn('[Import] Meeting has no transcript');
      return;
    }

    try {
      console.log('[Import] Using shared generateTemplateSummaries function');

      // Use shared function (pass null to generate for all templates)
      const summaries = await this.summaryFunction(meeting, null);

      // Store summaries on meeting object
      meeting.summaries = summaries;

      console.log(`[Import] Generated ${summaries.length} template-based summaries`);
    } catch (error) {
      console.error('[Import] Error generating template summaries:', error);
      // Non-fatal error, continue without template summaries
    }
  }

  /**
   * Generate AI auto-summary for imported meeting using shared function
   */
  async generateSummary(meeting) {
    if (!this.autoSummaryFunction) {
      console.warn('[Import] Auto-summary function not available');
      return;
    }

    if (!meeting.transcript || meeting.transcript.length === 0) {
      console.log('[Import] Skipping summary generation - transcript is empty');
      return;
    }

    try {
      console.log('[Import] Using shared generateMeetingSummary function');

      // Use shared function (no streaming for imports)
      const summaryContent = await this.autoSummaryFunction(meeting, null);

      if (!summaryContent) {
        console.warn('[Import] No summary content returned');
        return;
      }

      // Update meeting content with summary
      meeting.content = `# Meeting: ${meeting.title}\n\n`;
      meeting.content += `**AI Summary:**\n\n${summaryContent}\n\n`;
      meeting.content += `---\n\n`;
      meeting.content += meeting.content.split('---')[1] || ''; // Keep the rest of the content

      console.log('[Import] Auto-summary generated successfully');
    } catch (error) {
      console.error('[Import] Error generating summary:', error);
      // Non-fatal error, continue without summary
    }
  }

  /**
   * Export imported meeting to Obsidian vault using shared export function
   */
  async exportToObsidian(meeting) {
    if (!this.exportFunction) {
      console.warn('[Import] Export function not available');
      return;
    }

    try {
      console.log('[Import] Exporting meeting to Obsidian...');

      const result = await this.exportFunction(meeting);

      if (result.success && result.obsidianLink) {
        // Update meeting with Obsidian link
        meeting.obsidianLink = result.obsidianLink;
        console.log(`[Import] Exported to: ${result.obsidianLink}`);
      } else if (!result.success) {
        console.error('[Import] Export failed:', result.error);
      }

      return result;
    } catch (error) {
      console.error('[Import] Error exporting to Obsidian:', error);
      // Non-fatal error
    }
  }
}

module.exports = ImportManager;
