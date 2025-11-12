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
  constructor({ routingEngine, llmService, vaultStructure, fileOperationManager }) {
    this.parser = new TranscriptParser();
    this.extractor = new MetadataExtractor();
    this.routingEngine = routingEngine;
    this.llmService = llmService;
    this.vaultStructure = vaultStructure;
    this.fileOperationManager = fileOperationManager;
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

      // Step 5: Generate summary (optional)
      if (generateSummary && meeting.transcript && meeting.transcript.length > 0) {
        if (onProgress) onProgress({ step: 'generating-summary', file: path.basename(filePath) });
        await this.generateSummary(meeting);
      }

      // Step 6: Export to Obsidian (optional)
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
   * Generate AI summary for imported meeting
   */
  async generateSummary(meeting) {
    if (!this.llmService || !meeting.transcript) {
      return;
    }

    try {
      // Create transcript text from entries (simple format with speaker and text)
      const transcriptText = meeting.transcript
        .map(entry => `${entry.speaker}: ${entry.text}`)
        .join('\n');

      // Skip if transcript is empty
      if (!transcriptText || transcriptText.trim().length === 0) {
        console.log('[Import] Skipping summary generation - transcript is empty');
        return;
      }

      const prompt = `Please provide a brief summary of this meeting transcript:

${transcriptText}

Include:
1. Main topics discussed
2. Key decisions made
3. Action items (if any)
4. Overall outcome`;

      const summary = await this.llmService.generateCompletion({
        systemPrompt: 'You are a helpful assistant that summarizes meeting transcripts.',
        userPrompt: prompt,
        temperature: 0.3,
        maxTokens: 500
      });

      // Update meeting content with summary
      const summaryContent = summary.content || summary;
      meeting.content = `# Meeting: ${meeting.title}\n\n`;
      meeting.content += `**AI Summary:**\n\n${summaryContent}\n\n`;
      meeting.content += `---\n\n`;
      meeting.content += meeting.content.split('---')[1] || ''; // Keep the rest of the content
    } catch (error) {
      console.error('Error generating summary:', error);
      // Non-fatal error, continue without summary
    }
  }

  /**
   * Export imported meeting to Obsidian vault
   */
  async exportToObsidian(meeting) {
    if (!this.routingEngine || !this.vaultStructure) {
      console.warn('Routing engine or vault structure not available');
      return;
    }

    try {
      // Determine routing based on participant emails
      const decision = this.routingEngine.route({
        participantEmails: meeting.participantEmails || [],
        meetingTitle: meeting.title,
        meetingDate: new Date(meeting.date)
      });

      if (!decision || !decision.routes || decision.routes.length === 0) {
        console.warn('No routes found for imported meeting');
        return;
      }

      // Use first route
      const route = decision.routes[0];

      // Generate file paths
      const dateStr = new Date(meeting.date).toISOString().split('T')[0];
      const slug = meeting.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const summaryFilename = `${dateStr}-${slug}.md`;
      const transcriptFilename = `${dateStr}-${slug}-transcript.md`;

      // Create summary content
      const summaryContent = this.createSummaryMarkdown(meeting);

      // Create transcript content
      const transcriptContent = this.createTranscriptMarkdown(meeting);

      // Write files using the route's base path
      const meetingsPath = path.dirname(route.fullPath);

      const summaryPath = path.join(meetingsPath, summaryFilename);
      const transcriptPath = path.join(meetingsPath, transcriptFilename);

      this.vaultStructure.ensureDirectory(meetingsPath);
      await this.fileOperationManager.writeFile(summaryPath, summaryContent);
      await this.fileOperationManager.writeFile(transcriptPath, transcriptContent);

      // Update meeting with Obsidian link
      meeting.obsidianLink = summaryPath.replace(this.vaultStructure.getAbsolutePath(''), '').replace(/\\/g, '/').replace(/^\//, '');

      console.log(`Exported imported meeting to: ${summaryPath}`);
    } catch (error) {
      console.error('Error exporting to Obsidian:', error);
      // Non-fatal error
    }
  }

  /**
   * Create summary markdown file content
   */
  createSummaryMarkdown(meeting) {
    const date = new Date(meeting.date);

    let content = '---\n';
    content += `title: "${meeting.title}"\n`;
    content += `date: ${date.toISOString()}\n`;
    content += `participants:\n`;
    meeting.participants.forEach(p => {
      content += `  - ${p.name}\n`;
    });
    content += `platform: ${meeting.platform || 'unknown'}\n`;
    content += `duration: ${meeting.duration || 0}\n`;
    content += `source: import\n`;
    content += `imported_from: "${meeting.importedFrom}"\n`;
    content += '---\n\n';

    content += meeting.content;

    content += `\n\n---\n\n`;
    content += `*This meeting was imported from ${meeting.importedFrom}*\n\n`;
    content += `[[${path.basename(meeting.title)}-transcript|View Full Transcript]]\n`;

    return content;
  }

  /**
   * Create transcript markdown file content
   */
  createTranscriptMarkdown(meeting) {
    let content = '---\n';
    content += `title: "${meeting.title} - Transcript"\n`;
    content += `date: ${meeting.date}\n`;
    content += '---\n\n';

    content += `# ${meeting.title} - Full Transcript\n\n`;
    content += `**Date:** ${new Date(meeting.date).toLocaleDateString()}\n\n`;

    if (meeting.transcript && meeting.transcript.length > 0) {
      meeting.transcript.forEach(participant => {
        if (participant.words && participant.words.length > 0) {
          content += `\n## ${participant.name}\n\n`;

          const text = participant.words.map(w => w.word).join(' ');
          content += `${text}\n`;
        }
      });
    }

    content += `\n\n---\n\n`;
    content += `*Generated from imported transcript*\n`;

    return content;
  }
}

module.exports = ImportManager;
