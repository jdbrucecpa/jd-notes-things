/**
 * Shared TypeScript types for JD Notes Things
 */

// Recording Status
export type RecordingStatus = 'idle' | 'recording' | 'paused' | 'processing';

// Recording Session
export interface RecordingSession {
  id: string;
  startTime: Date;
  endTime?: Date;
  status: RecordingStatus;
  audioFilePath?: string;
  transcriptFilePath?: string;
  participants?: Participant[];
  meetingTitle?: string;
  platform?: MeetingPlatform;
}

// Meeting Platforms
export type MeetingPlatform = 'zoom' | 'teams' | 'meet' | 'manual' | 'unknown';

// Participant
export interface Participant {
  name?: string;
  email?: string;
  organization?: string;
}

// Transcript Segment
export interface TranscriptSegment {
  speaker: string;
  text: string;
  timestamp: Date;
  confidence?: number;
}

// Full Transcript
export interface Transcript {
  sessionId: string;
  segments: TranscriptSegment[];
  metadata: {
    duration: number;
    participants: Participant[];
    meetingTitle?: string;
    platform?: MeetingPlatform;
  };
}

// IPC Channel Names
export enum IPCChannel {
  // Recording controls
  START_RECORDING = 'recording:start',
  STOP_RECORDING = 'recording:stop',
  PAUSE_RECORDING = 'recording:pause',
  RESUME_RECORDING = 'recording:resume',

  // Recording events
  RECORDING_STARTED = 'recording:started',
  RECORDING_STOPPED = 'recording:stopped',
  RECORDING_ERROR = 'recording:error',

  // Transcription
  TRANSCRIPTION_COMPLETE = 'transcription:complete',
  TRANSCRIPTION_ERROR = 'transcription:error',

  // File operations
  SAVE_TRANSCRIPT = 'file:save-transcript',

  // Settings
  GET_SETTINGS = 'settings:get',
  UPDATE_SETTINGS = 'settings:update',
}

// App Settings
export interface AppSettings {
  vaultPath: string;
  recallApiUrl: string;
  recallApiKey?: string;
  assemblyAiApiKey?: string;
  audioQuality: {
    sampleRate: number;
    bitrate: number;
    format: 'wav' | 'mp3';
  };
  autoStartRecording: boolean;
  encryptionEnabled: boolean;
}
