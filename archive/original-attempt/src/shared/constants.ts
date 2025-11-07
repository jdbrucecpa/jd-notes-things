/**
 * Shared constants for JD Notes Things
 */

// App Information
export const APP_NAME = 'JD Notes Things';
export const APP_VERSION = '0.1.0';
export const COMPANY_NAME = 'JD Knows Things';

// File Naming
export const TRANSCRIPT_FILE_SUFFIX = 'transcript.md';
export const AUDIO_FILE_EXTENSION = '.wav';

// Default Settings
export const DEFAULT_VAULT_PATH = './vault';
export const DEFAULT_SAMPLE_RATE = 44100;
export const DEFAULT_BITRATE = 192000;
export const DEFAULT_AUDIO_FORMAT = 'wav' as const;
export const DEFAULT_TRANSCRIPTION_PROVIDER = 'assemblyai' as const;

// API Endpoints
export const DEFAULT_RECALL_API_URL = 'https://us-east-1.recall.ai';

// Transcription
export const ASSEMBLYAI_API_URL = 'https://api.assemblyai.com/v2';

// File Paths
export const CONFIG_DIR = 'config';
export const TEMPLATES_DIR = 'config/templates';
export const ROUTING_CONFIG_FILE = 'config/routing.yaml';

// Meeting Detection
export const MEETING_PLATFORMS = {
  ZOOM: 'zoom',
  TEAMS: 'teams',
  MEET: 'meet',
  MANUAL: 'manual',
  UNKNOWN: 'unknown',
} as const;
