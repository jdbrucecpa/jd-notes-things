const { z } = require('zod');

// Participant schema
const ParticipantSchema = z
  .object({
    name: z.string(),
    id: z
      .union([z.string(), z.number()])
      .optional()
      .transform(val => (val !== undefined ? String(val) : undefined)),
    email: z.string().nullable().optional(), // SM-2: Added for speaker mapping
    mappedFromSpeakerId: z.string().optional(), // SM-2: Track which speaker ID was mapped
  })
  .passthrough(); // Allow additional fields for flexibility

// Transcript entry schema
// Accept both string and number timestamps for backwards compatibility
const TranscriptEntrySchema = z
  .object({
    speaker: z.string(),
    text: z.string(),
    timestamp: z
      .union([z.number(), z.string(), z.null()])
      .optional()
      .transform(val => {
        if (val === null || val === undefined) {
          return undefined; // Omit null/undefined timestamps
        }
        if (typeof val === 'string') {
          // Try to parse string timestamp to number
          const parsed = parseFloat(val);
          return isNaN(parsed) ? Date.parse(val) : parsed;
        }
        return val;
      }),
    // SM-2: Speaker mapping fields
    speakerName: z.string().optional(), // Mapped contact name
    speakerEmail: z.string().nullable().optional(), // Mapped contact email
    speakerDisplayName: z.string().optional(), // Display name (may include wiki-links)
    speakerMapped: z.boolean().optional(), // Flag indicating speaker was mapped
  })
  .passthrough(); // Allow additional fields for flexibility

// Meeting schema
const MeetingSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(['profile', 'calendar', 'document', 'imported']), // 'imported' for backwards compatibility
    title: z.string(),
    date: z.string(),
    participants: z.array(ParticipantSchema).optional(),
    transcript: z.array(TranscriptEntrySchema).optional(),
    content: z.string().optional(),
    summary: z.string().optional(),
    recordingId: z.string().optional(),
    platform: z
      .string()
      .nullable()
      .optional()
      .transform(val => (val === null ? undefined : val)),
    subtitle: z.string().optional(), // Added for UI display
    hasDemo: z.boolean().optional(), // Added for UI display
    summaries: z.array(z.any()).optional(), // Added for LLM summaries
    participantEmails: z.array(z.string()).optional(), // Added for routing
    videoFile: z.string().optional(), // Added for recording
    start: z.string().optional(), // Added for calendar events
    end: z.string().optional(), // Added for calendar events
    link: z.string().optional(), // Added for meeting links
    description: z.string().optional(), // Added for calendar events
    obsidianLink: z.string().optional(), // Added for Obsidian vault path tracking
  })
  .passthrough(); // Allow additional fields for flexibility

// Meetings data schema (for saveMeetingsData)
const MeetingsDataSchema = z.object({
  upcomingMeetings: z.array(MeetingSchema),
  pastMeetings: z.array(MeetingSchema),
});

// Simple ID validators for handlers
const MeetingIdSchema = z.string().min(1);
const RecordingIdSchema = z.string().min(1);

module.exports = {
  MeetingSchema,
  MeetingsDataSchema,
  MeetingIdSchema,
  RecordingIdSchema,
  ParticipantSchema,
  TranscriptEntrySchema,
};
