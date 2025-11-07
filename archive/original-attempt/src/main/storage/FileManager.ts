/**
 * File Manager for saving transcripts and audio files
 * Handles file naming, formatting, and directory creation
 */

import * as fs from 'fs';
import * as path from 'path';
import { Transcript, TranscriptSegment } from '../../shared/types';

export class FileManager {
  private outputDirectory: string;

  constructor(outputDirectory: string = './') {
    this.outputDirectory = outputDirectory;
  }

  /**
   * Save transcript to a markdown file
   * @param transcript - The transcript to save
   * @returns Path to the saved file
   */
  async saveTranscript(transcript: Transcript): Promise<string> {
    const filename = this.generateFilename('transcript');
    const filePath = path.join(this.outputDirectory, filename);

    console.log(`[FileManager] Saving transcript to: ${filePath}`);

    // Generate markdown content
    const markdown = this.generateMarkdown(transcript);

    // Ensure output directory exists
    this.ensureDirectoryExists(this.outputDirectory);

    // Write file
    fs.writeFileSync(filePath, markdown, 'utf-8');

    console.log(`[FileManager] Transcript saved successfully`);

    return filePath;
  }

  /**
   * Generate filename with timestamp
   * Format: YYYY-MM-DD-HH-MM-{suffix}.md
   */
  private generateFilename(suffix: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day}-${hours}-${minutes}-${suffix}.md`;
  }

  /**
   * Generate markdown content from transcript
   */
  private generateMarkdown(transcript: Transcript): string {
    const lines: string[] = [];

    // Header
    lines.push('# Meeting Transcript\n');

    // Metadata
    lines.push('## Metadata\n');
    lines.push(`- **Duration**: ${this.formatDuration(transcript.metadata.duration)}`);
    lines.push(`- **Platform**: ${transcript.metadata.platform || 'Unknown'}`);
    lines.push(`- **Participants**: ${transcript.metadata.participants.length}`);

    if (transcript.metadata.meetingTitle) {
      lines.push(`- **Title**: ${transcript.metadata.meetingTitle}`);
    }

    lines.push('');

    // Participants
    if (transcript.metadata.participants.length > 0) {
      lines.push('## Participants\n');
      for (const participant of transcript.metadata.participants) {
        const name = participant.name || 'Unknown';
        const email = participant.email ? ` (${participant.email})` : '';
        const org = participant.organization ? ` - ${participant.organization}` : '';
        lines.push(`- ${name}${email}${org}`);
      }
      lines.push('');
    }

    // Transcript
    lines.push('## Transcript\n');

    for (const segment of transcript.segments) {
      const timestamp = this.formatTimestamp(segment.timestamp);
      const confidence = segment.confidence
        ? ` *(confidence: ${(segment.confidence * 100).toFixed(0)}%)*`
        : '';

      lines.push(`**[${timestamp}] ${segment.speaker}${confidence}:**`);
      lines.push(`${segment.text}\n`);
    }

    return lines.join('\n');
  }

  /**
   * Format duration in seconds to HH:MM:SS
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  /**
   * Format timestamp to HH:MM:SS
   */
  private formatTimestamp(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  /**
   * Ensure directory exists, create if it doesn't
   */
  private ensureDirectoryExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      console.log(`[FileManager] Created directory: ${dirPath}`);
    }
  }

  /**
   * Set output directory
   */
  setOutputDirectory(directory: string): void {
    this.outputDirectory = directory;
    this.ensureDirectoryExists(directory);
  }

  /**
   * Get current output directory
   */
  getOutputDirectory(): string {
    return this.outputDirectory;
  }
}
