/**
 * Zod validation schemas for IPC handlers
 * Only includes schemas that are actively used
 */

const { z } = require('zod');

/**
 * Common field schemas (used by other schemas)
 */
const meetingIdSchema = z.string().min(1, 'Meeting ID cannot be empty');
const templateIdSchema = z.string().min(1, 'Template ID cannot be empty');
const providerSchema = z.enum(['openai', 'anthropic', 'azure']);

/**
 * Transcript entry schema
 */
const transcriptEntrySchema = z.object({
  speaker: z.string().optional(),
  speakerId: z.string().optional(),
  speakerName: z.string().optional(), // Mapped speaker name (after speaker matching)
  speakerEmail: z.string().nullable().optional(), // Speaker's email if matched
  speakerDisplayName: z.string().optional(), // Display name with wiki links
  speakerMapped: z.boolean().optional(), // Whether speaker was mapped
  text: z.string(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  words: z.array(z.any()).optional(),
});

// ===================================================
// Speaker Mapping Schemas (actively used)
// ===================================================

const speakerMappingGetSuggestionsSchema = z.object({
  speakerIds: z.array(z.string()),
});

const speakerMappingDeleteSchema = z.object({
  speakerId: z.string().min(1),
});

const speakerMappingExtractSchema = z.object({
  transcript: z.array(transcriptEntrySchema),
});

const speakerMappingDetectDuplicatesSchema = z.object({
  speakers: z.array(z.string()),
});

const speakerMappingApplySchema = z.object({
  meetingId: meetingIdSchema,
  mappings: z.record(
    z.string(),
    z.object({
      contactName: z.string(),
      contactEmail: z.string().nullable().optional(),
      obsidianLink: z.string().optional(),
      merged: z.boolean().optional(),
      autoMerged: z.boolean().optional(),
    })
  ),
  options: z
    .object({
      useWikiLinks: z.boolean().optional(),
    })
    .optional(),
});

const speakerMappingImportSchema = z.object({
  data: z.record(z.string(), z.any()),
  merge: z.boolean().optional(),
});

// ===================================================
// Template Schemas (actively used)
// ===================================================

const templatesEstimateCostSchema = z.object({
  templateIds: z.array(templateIdSchema),
  transcript: z.array(transcriptEntrySchema),
});

const routingOverrideSchema = z
  .object({
    type: z.enum(['client', 'industry', 'internal', 'unfiled']),
    slug: z.string().min(1),
    path: z.string().min(1),
    organization: z.string().optional(),
    reason: z.string().optional(),
  })
  .nullable()
  .optional();

const templatesGenerateSummariesSchema = z.object({
  meetingId: meetingIdSchema,
  templateIds: z.array(templateIdSchema),
  routingOverride: routingOverrideSchema,
  mode: z.enum(['replace', 'append']).optional().default('replace'),
  model: z.string().nullable().optional(),
});

// ===================================================
// LLM Schema (actively used)
// ===================================================

const llmSwitchProviderSchema = z.object({
  provider: providerSchema,
});

// ===================================================
// Vocabulary Schemas (actively used)
// ===================================================

const vocabularySpellingSchema = z.object({
  from: z.union([z.string(), z.array(z.string())]),
  to: z.string().min(1),
});

const vocabularyKeywordSchema = z.object({
  word: z.string().min(1),
  intensifier: z.number().int().min(1).max(10).optional(),
});

const vocabularyClientSpellingSchema = z.object({
  clientSlug: z.string().min(1),
  from: z.union([z.string(), z.array(z.string())]),
  to: z.string().min(1),
});

const vocabularyClientKeywordSchema = z.object({
  clientSlug: z.string().min(1),
  word: z.string().min(1),
  intensifier: z.number().int().min(1).max(10).optional(),
});

const vocabularyRemoveSpellingSchema = z.object({
  to: z.string().min(1),
});

const vocabularyRemoveKeywordSchema = z.object({
  word: z.string().min(1),
});

// ===================================================
// Pattern Schemas (actively used)
// ===================================================

const patternsTestParseSchema = z.object({
  content: z.string(),
  filePath: z.string(),
});

const patternsSaveConfigSchema = z.object({
  configYaml: z.string(),
});

// ===================================================
// Import Schemas (actively used)
// ===================================================

const filePathSchema = z.string().min(1, 'File path cannot be empty');

const importFileSchema = z.object({
  filePath: filePathSchema,
  options: z.object({}).passthrough().optional(),
});

const importBatchSchema = z.object({
  filePaths: z.array(filePathSchema),
  options: z.object({}).passthrough().optional(),
});

const importTranscribeAudioSchema = z.object({
  filePath: filePathSchema,
  provider: z.string().optional(),
  options: z.object({}).passthrough().optional(),
});

const importAudioFileSchema = z.object({
  filePath: filePathSchema,
  provider: z.string().optional(),
  options: z.object({}).passthrough().optional(),
});

// ===================================================
// Google Auth Schemas
// ===================================================

const googleAuthenticateSchema = z.object({
  code: z.string().min(1, 'Authorization code cannot be empty'),
  state: z.string().min(1, 'State parameter cannot be empty'),
});

// ===================================================
// Speaker Matching Schemas
// ===================================================

const speakersMatchSchema = z.object({
  transcript: z.array(transcriptEntrySchema),
  participantEmails: z.array(z.string()).optional(),
  options: z.object({}).passthrough().optional(),
  recordingId: z.string().optional(),
});

const speakersUpdateMappingSchema = z.object({
  meetingId: meetingIdSchema,
  speakerLabel: z.string().min(1, 'Speaker label cannot be empty'),
  participantEmail: z.string().email('Invalid email format'),
});

const speakerMappingAddSchema = z.object({
  speakerId: z.string().min(1, 'Speaker ID cannot be empty'),
  contact: z.object({
    name: z.string().optional(),
    email: z.string().optional(),
  }),
  sourceContext: z.string().optional(),
});

const speakerMappingApplyToTranscriptSchema = z.object({
  transcript: z.array(transcriptEntrySchema),
  mappings: z.record(z.string(), z.any()),
  options: z.object({}).passthrough().optional(),
});

// ===================================================
// Routing Schemas
// ===================================================

const routingTypeSchema = z.enum(['client', 'industry', 'internal']);

const routingAddOrganizationSchema = z.object({
  type: routingTypeSchema,
  id: z.string().min(1, 'Organization ID cannot be empty'),
  vaultPath: z.string().min(1, 'Vault path cannot be empty'),
  emails: z.array(z.string()).optional(),
  contacts: z.array(z.string()).optional(),
});

const routingAddEmailsSchema = z.object({
  type: routingTypeSchema,
  slug: z.string().min(1, 'Slug cannot be empty'),
  emails: z.array(z.string()).optional(),
  contacts: z.array(z.string()).optional(),
});

const routingDeleteOrganizationSchema = z.object({
  type: routingTypeSchema,
  id: z.string().min(1, 'Organization ID cannot be empty'),
});

// ===================================================
// Simple Input Schemas (strings, booleans, etc.)
// ===================================================

const stringIdSchema = z.string().min(1, 'ID cannot be empty');
const optionalStringSchema = z.string().optional();
const booleanSchema = z.boolean();
const optionalBooleanSchema = z.boolean().optional();
const hoursAheadSchema = z.number().int().min(1).max(168).optional();

// Contact-related schemas
const contactSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  company: z.string().optional(),
  phone: z.string().optional(),
});

const contactPageOptionsSchema = z.object({
  createCompanyPage: z.boolean().optional(),
}).optional();

// Settings/config schemas
const userProfileSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  company: z.string().optional(),
  role: z.string().optional(),
}).passthrough();

const appSettingsSchema = z.object({}).passthrough();

const logsOptionsSchema = z.object({
  lines: z.number().int().min(1).max(10000).optional(),
  level: z.string().optional(),
}).optional();

// Key management schemas
const keyNameSchema = z.string().min(1, 'Key name cannot be empty');

// Import schemas
const importOptionsSchema = z.object({
  overwriteSettings: z.boolean().optional(),
  importMeetings: z.boolean().optional(),
  importTemplates: z.boolean().optional(),
}).optional();

// Vocabulary config schema (for bulk save)
const vocabularyConfigSchema = z.object({}).passthrough();

// Meeting field update schema
const updateMeetingFieldSchema = z.object({
  meetingId: z.string().min(1, 'Meeting ID cannot be empty'),
  field: z.enum(['platform', 'title', 'status', 'vaultPath', 'obsidianLink', 'exportedAt']),
  value: z.string().nullable(),
});

// Per-meeting auto-start schema
const meetingAutoStartSchema = z.object({
  meetingId: z.string().min(1, 'Meeting ID cannot be empty'),
  enabled: z.boolean().nullable(),
});

// Transcription provider schema
const transcriptionProviderSchema = z.enum(['assemblyai', 'deepgram', 'recallai']).optional();

// ===================================================
// Widget Schemas (actively used)
// ===================================================

const widgetStartRecordingSchema = z
  .string()
  .min(1, 'Meeting ID cannot be empty')
  .nullable()
  .optional();

const widgetToggleAlwaysOnTopSchema = z.boolean();

const widgetMeetingInfoSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().max(500).optional(),
    startTime: z.union([z.string(), z.number(), z.date()]).optional(),
    endTime: z.union([z.string(), z.number(), z.date()]).optional(),
    platform: z.string().optional(),
    meetingLink: z.string().url().optional().nullable(),
    participants: z
      .array(
        z.object({
          name: z.string().optional(),
          email: z.string().optional(),
        })
      )
      .optional(),
  })
  .nullable()
  .optional();

// ===================================================
// Helper Functions
// ===================================================

/**
 * Validate IPC input against a schema
 * @param {z.ZodSchema} schema - Zod schema to validate against
 * @param {any} data - Data to validate
 * @returns {object} Validated data
 * @throws {Error} If validation fails
 */
function validateIpcInput(schema, data) {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ');
      throw new Error(`IPC Input Validation Failed: ${issues}`);
    }
    throw error;
  }
}

/**
 * Wrap an IPC handler with input validation
 * @param {z.ZodSchema} schema - Zod schema for input validation
 * @param {Function} handler - Original IPC handler function
 * @returns {Function} Wrapped handler with validation
 */
function withValidation(schema, handler) {
  return async (event, data) => {
    const validatedData = validateIpcInput(schema, data);
    return handler(event, validatedData);
  };
}

module.exports = {
  // Speaker mapping schemas
  speakerMappingGetSuggestionsSchema,
  speakerMappingDeleteSchema,
  speakerMappingExtractSchema,
  speakerMappingDetectDuplicatesSchema,
  speakerMappingApplySchema,
  speakerMappingImportSchema,
  speakerMappingAddSchema,
  speakerMappingApplyToTranscriptSchema,
  // Speaker matching schemas
  speakersMatchSchema,
  speakersUpdateMappingSchema,
  // Google auth schemas
  googleAuthenticateSchema,
  // Routing schemas
  routingAddOrganizationSchema,
  routingAddEmailsSchema,
  routingDeleteOrganizationSchema,
  // Template schemas
  templatesEstimateCostSchema,
  templatesGenerateSummariesSchema,
  // LLM schema
  llmSwitchProviderSchema,
  // Vocabulary schemas
  vocabularySpellingSchema,
  vocabularyKeywordSchema,
  vocabularyClientSpellingSchema,
  vocabularyClientKeywordSchema,
  vocabularyRemoveSpellingSchema,
  vocabularyRemoveKeywordSchema,
  // Pattern schemas
  patternsTestParseSchema,
  patternsSaveConfigSchema,
  // Import schemas
  importFileSchema,
  importBatchSchema,
  importTranscribeAudioSchema,
  importAudioFileSchema,
  // Widget schemas
  widgetStartRecordingSchema,
  widgetToggleAlwaysOnTopSchema,
  widgetMeetingInfoSchema,
  // Simple input schemas
  stringIdSchema,
  optionalStringSchema,
  booleanSchema,
  optionalBooleanSchema,
  hoursAheadSchema,
  // Contact schemas
  contactSchema,
  contactPageOptionsSchema,
  // Settings/config schemas
  userProfileSchema,
  appSettingsSchema,
  logsOptionsSchema,
  // Key management schemas
  keyNameSchema,
  // Import options schema
  importOptionsSchema,
  // Vocabulary config schema
  vocabularyConfigSchema,
  // Meeting update schemas
  updateMeetingFieldSchema,
  meetingAutoStartSchema,
  // Transcription provider schema
  transcriptionProviderSchema,
  // Helpers
  validateIpcInput,
  withValidation,
};
