/**
 * Zod validation schemas for IPC handlers
 * Prevents malformed data from crashing the main process
 */

const { z } = require('zod');

/**
 * Common field schemas
 */
const meetingIdSchema = z.string().min(1, 'Meeting ID cannot be empty');
const emailSchema = z.string().email('Invalid email format');
const templateIdSchema = z.string().min(1, 'Template ID cannot be empty');
const providerSchema = z.enum(['openai', 'anthropic', 'azure']);

/**
 * Transcript entry schema
 */
const transcriptEntrySchema = z.object({
  speaker: z.string().optional(),
  speakerId: z.string().optional(),
  text: z.string(),
  timestamp: z.union([z.string(), z.number()]).optional(),
  words: z.array(z.any()).optional(),
});

/**
 * Participant schema
 */
const participantSchema = z.object({
  name: z.string().optional(),
  email: emailSchema.optional(),
  organization: z.string().optional(),
  role: z.string().optional(),
});

/**
 * Meeting data schema
 */
const meetingDataSchema = z.object({
  id: meetingIdSchema,
  title: z.string().min(1, 'Meeting title cannot be empty'),
  date: z.string(),
  content: z.string().optional(),
  transcript: z.array(transcriptEntrySchema).optional(),
  participants: z.array(participantSchema).optional(),
  participantEmails: z.array(emailSchema).optional(),
  platform: z.string().optional(),
  duration: z.union([z.string(), z.number()]).optional(),
  obsidianLink: z.string().optional(),
  summaries: z
    .array(
      z.object({
        templateId: z.string(),
        templateName: z.string(),
        content: z.string(),
      })
    )
    .optional(),
});

/**
 * IPC Handler Schemas
 */

// saveMeetingsData
const saveMeetingsDataSchema = z.object({
  upcomingMeetings: z.array(meetingDataSchema),
  pastMeetings: z.array(meetingDataSchema),
});

// google:authenticate
const googleAuthenticateSchema = z.object({
  code: z.string().min(1, 'Authorization code cannot be empty'),
});

// calendar:getUpcomingMeetings
const calendarGetUpcomingMeetingsSchema = z.object({
  hoursAhead: z.number().int().positive().max(168).optional().default(24), // Max 1 week
});

// contacts:fetchContacts
const contactsFetchContactsSchema = z.object({
  forceRefresh: z.boolean().optional().default(false),
});

// speakers:matchSpeakers
const speakersMatchSpeakersSchema = z.object({
  transcript: z.array(transcriptEntrySchema),
  participantEmails: z.array(emailSchema),
});

// templates:getById
const templatesGetByIdSchema = z.object({
  templateId: templateIdSchema,
});

// templates:estimateCost
const templatesEstimateCostSchema = z.object({
  templateIds: z.array(templateIdSchema),
  transcript: z.array(transcriptEntrySchema),
});

// templates:generateSummaries
// CS-4.4: Added optional routingOverride for manual destination selection
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
});

// llm:switchProvider
const llmSwitchProviderSchema = z.object({
  provider: providerSchema,
});

// obsidian:exportMeeting
const obsidianExportMeetingSchema = z.object({
  meetingId: meetingIdSchema,
});

// recording:getActiveId
const recordingGetActiveIdSchema = z.object({
  noteId: z.string().min(1, 'Note ID cannot be empty'),
});

// recording:startManual
const recordingStartManualSchema = z.object({
  meetingTitle: z.string().min(1, 'Meeting title cannot be empty').optional(),
  participantEmails: z.array(emailSchema).optional(),
});

// import:importFile
const importFileSchema = z.object({
  filePath: z.string().min(1, 'File path cannot be empty'),
  metadata: z
    .object({
      title: z.string().optional(),
      date: z.string().optional(),
      participants: z.array(participantSchema).optional(),
    })
    .optional(),
  templateIds: z.array(templateIdSchema).optional(),
});

// import:importBatch
const importBatchSchema = z.object({
  files: z.array(
    z.object({
      filePath: z.string(),
      metadata: z
        .object({
          title: z.string().optional(),
          date: z.string().optional(),
          participants: z.array(participantSchema).optional(),
        })
        .optional(),
    })
  ),
  templateIds: z.array(templateIdSchema).optional(),
});

/**
 * Validation helper function
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
      const issues = error.issues
        .map(issue => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
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
  // Schemas
  meetingIdSchema,
  emailSchema,
  templateIdSchema,
  providerSchema,
  transcriptEntrySchema,
  participantSchema,
  meetingDataSchema,
  saveMeetingsDataSchema,
  googleAuthenticateSchema,
  calendarGetUpcomingMeetingsSchema,
  contactsFetchContactsSchema,
  speakersMatchSpeakersSchema,
  templatesGetByIdSchema,
  templatesEstimateCostSchema,
  templatesGenerateSummariesSchema,
  llmSwitchProviderSchema,
  obsidianExportMeetingSchema,
  recordingGetActiveIdSchema,
  recordingStartManualSchema,
  importFileSchema,
  importBatchSchema,

  // Helpers
  validateIpcInput,
  withValidation,
};
