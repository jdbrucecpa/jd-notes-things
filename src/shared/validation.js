const { z } = require('zod');

// Participant schema
const ParticipantSchema = z.object({
  name: z.string(),
  id: z.string().optional(),
});

// Transcript entry schema
const TranscriptEntrySchema = z.object({
  speaker: z.string(),
  text: z.string(),
  timestamp: z.number().optional(),
});

// Meeting schema
const MeetingSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['profile', 'calendar', 'document']),
  title: z.string(),
  date: z.string(),
  participants: z.array(ParticipantSchema).optional(),
  transcript: z.array(TranscriptEntrySchema).optional(),
  content: z.string().optional(),
  summary: z.string().optional(),
  recordingId: z.string().optional(),
  platform: z.string().optional(),
});

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
