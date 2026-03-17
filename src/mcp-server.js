#!/usr/bin/env node
/**
 * MCP Server for JD Notes Things (v1.4)
 *
 * Standalone entry point that exposes meeting data to Claude Desktop.
 * Read-only access to SQLite database via MCP tools.
 *
 * Usage: node src/mcp-server.js --db-path <path-to-meetings.db>
 *
 * Claude Desktop config (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "jd-notes": {
 *       "command": "node",
 *       "args": ["<path>/src/mcp-server.js", "--db-path", "<userData>/meetings.db"]
 *     }
 *   }
 * }
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const Database = require('better-sqlite3');
const { z } = require('zod');

// Parse command line args
const args = process.argv.slice(2);
const dbPathIdx = args.indexOf('--db-path');
const dbPath = dbPathIdx !== -1 ? args[dbPathIdx + 1] : null;

if (!dbPath) {
  process.stderr.write('Usage: node mcp-server.js --db-path <path-to-meetings.db>\n');
  process.exit(1);
}

// Open database in read-only mode (WAL supports concurrent readers)
let db;
try {
  db = new Database(dbPath, { readonly: true });
  db.pragma('journal_mode = WAL');
} catch (error) {
  process.stderr.write(`Failed to open database: ${error.message}\n`);
  process.exit(1);
}

// Clean up on exit
process.on('exit', () => { if (db) db.close(); });
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

// Create MCP server
const server = new McpServer({
  name: 'jd-notes-things',
  version: '1.4.0',
});

// ===================================================================
// Tool 1: search_meetings
// ===================================================================
server.registerTool(
  'search_meetings',
  {
    description: 'Search meetings by date range, title, participant, or company. Returns meeting summaries.',
    inputSchema: z.object({
      startDate: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().optional().describe('End date (YYYY-MM-DD)'),
      title: z.string().optional().describe('Search in meeting title'),
      participant: z.string().optional().describe('Participant name or email'),
      company: z.string().optional().describe('Company/organization name'),
      limit: z.number().optional().describe('Max results (default 20)'),
    }),
  },
  async ({ startDate, endDate, title, participant, company, limit: maxResults }) => {
    const resultLimit = maxResults || 20;
    let sql = 'SELECT DISTINCT m.id, m.title, m.date, m.platform, m.summary, m.status FROM meetings m';
    const params = [];
    const joins = [];

    // JOIN participants table when filtering by participant or company
    if (participant || company) {
      joins.push('JOIN participants p ON p.meeting_id = m.id');
    }

    sql += ' ' + joins.join(' ') + ' WHERE 1=1';

    if (startDate) { sql += ' AND m.date >= ?'; params.push(startDate); }
    if (endDate) { sql += ' AND m.date <= ?'; params.push(endDate); }
    if (title) { sql += ' AND m.title LIKE ?'; params.push(`%${title}%`); }
    if (participant) {
      sql += ' AND (p.name LIKE ? OR p.email LIKE ?)';
      params.push(`%${participant}%`, `%${participant}%`);
    }
    if (company) {
      sql += ' AND p.organization LIKE ?';
      params.push(`%${company}%`);
    }

    sql += ' ORDER BY m.date DESC LIMIT ?';
    params.push(resultLimit);

    const meetings = db.prepare(sql).all(...params);

    const text = meetings.length === 0
      ? 'No meetings found matching the criteria.'
      : meetings.map(m =>
          `[${m.date}] ${m.title} (${m.platform || 'Unknown'})\nID: ${m.id}\n${m.summary ? m.summary.substring(0, 200) + '...' : 'No summary'}`
        ).join('\n\n---\n\n');

    return { content: [{ type: 'text', text }] };
  }
);

// ===================================================================
// Tool 2: get_meeting
// ===================================================================
server.registerTool(
  'get_meeting',
  {
    description: 'Get full meeting details including summary, participants, and metadata.',
    inputSchema: z.object({
      meetingId: z.string().describe('Meeting ID'),
    }),
  },
  async ({ meetingId }) => {
    const meeting = db.prepare('SELECT * FROM meetings WHERE id = ?').get(meetingId);
    if (!meeting) {
      return { content: [{ type: 'text', text: 'Meeting not found.' }] };
    }

    const participants = db.prepare('SELECT * FROM participants WHERE meeting_id = ?').all(meetingId);
    const attendees = db.prepare('SELECT * FROM calendar_attendees WHERE meeting_id = ?').all(meetingId);

    let text = `# ${meeting.title}\n\n`;
    text += `**Date:** ${meeting.date}\n`;
    text += `**Platform:** ${meeting.platform || 'Unknown'}\n`;
    text += `**Status:** ${meeting.status}\n`;
    if (meeting.duration) text += `**Duration:** ${Math.round(meeting.duration / 60)} minutes\n`;
    if (meeting.transcription_provider) text += `**Transcription:** ${meeting.transcription_provider}\n`;

    if (participants.length > 0) {
      text += `\n## Participants (${participants.length})\n`;
      for (const p of participants) {
        text += `- ${p.name}${p.email ? ` (${p.email})` : ''}${p.organization ? ` - ${p.organization}` : ''}${p.is_host ? ' [Host]' : ''}\n`;
      }
    }

    if (attendees.length > 0) {
      text += `\n## Calendar Attendees (${attendees.length})\n`;
      for (const a of attendees) {
        text += `- ${a.name || a.email} (${a.response_status || 'unknown'})\n`;
      }
    }

    if (meeting.summary) {
      text += `\n## Summary\n${meeting.summary}\n`;
    }

    if (meeting.summaries) {
      try {
        const summaries = JSON.parse(meeting.summaries);
        if (Array.isArray(summaries) && summaries.length > 0) {
          text += `\n## Template Summaries\n`;
          for (const s of summaries) {
            text += `### ${s.templateName || s.templateId || 'Template'}\n${s.content || s.text || ''}\n\n`;
          }
        }
      } catch { /* ignore parse errors */ }
    }

    return { content: [{ type: 'text', text }] };
  }
);

// ===================================================================
// Tool 3: get_transcript
// ===================================================================
server.registerTool(
  'get_transcript',
  {
    description: 'Get the full transcript for a meeting.',
    inputSchema: z.object({
      meetingId: z.string().describe('Meeting ID'),
    }),
  },
  async ({ meetingId }) => {
    const entries = db.prepare(
      'SELECT * FROM transcript_entries WHERE meeting_id = ? ORDER BY entry_order'
    ).all(meetingId);

    if (entries.length === 0) {
      return { content: [{ type: 'text', text: 'No transcript found for this meeting.' }] };
    }

    const text = entries.map(e => {
      const speaker = e.speaker_display_name || e.speaker_name || e.speaker;
      const ts = e.timestamp != null ? `[${formatTimestamp(e.timestamp)}] ` : '';
      return `${ts}**${speaker}:** ${e.text}`;
    }).join('\n');

    return { content: [{ type: 'text', text }] };
  }
);

// ===================================================================
// Tool 4: search_contacts
// ===================================================================
server.registerTool(
  'search_contacts',
  {
    description: 'Search participants across all meetings by name, email, or company.',
    inputSchema: z.object({
      query: z.string().describe('Search query (name, email, or company)'),
      limit: z.number().optional().describe('Max results (default 20)'),
    }),
  },
  async ({ query, limit: maxResults }) => {
    const resultLimit = maxResults || 20;
    const rows = db.prepare(`
      SELECT DISTINCT name, original_name, email, organization,
        COUNT(DISTINCT meeting_id) as meeting_count
      FROM participants
      WHERE name LIKE ? OR email LIKE ? OR organization LIKE ?
      GROUP BY COALESCE(email, name)
      ORDER BY meeting_count DESC
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, `%${query}%`, resultLimit);

    if (rows.length === 0) {
      return { content: [{ type: 'text', text: 'No contacts found.' }] };
    }

    const text = rows.map(r =>
      `${r.name}${r.email ? ` (${r.email})` : ''}${r.organization ? ` - ${r.organization}` : ''} [${r.meeting_count} meetings]`
    ).join('\n');

    return { content: [{ type: 'text', text }] };
  }
);

// ===================================================================
// Tool 5: get_contact
// ===================================================================
server.registerTool(
  'get_contact',
  {
    description: 'Get contact detail with meeting history.',
    inputSchema: z.object({
      email: z.string().describe('Contact email address'),
    }),
  },
  async ({ email }) => {
    const meetings = db.prepare(`
      SELECT DISTINCT m.id, m.title, m.date, m.platform
      FROM meetings m
      JOIN participants p ON p.meeting_id = m.id
      WHERE p.email = ?
      ORDER BY m.date DESC
    `).all(email);

    const participant = db.prepare(
      'SELECT * FROM participants WHERE email = ? LIMIT 1'
    ).get(email);

    let text = '';
    if (participant) {
      text += `# ${participant.name}\n`;
      text += `**Email:** ${email}\n`;
      if (participant.organization) text += `**Organization:** ${participant.organization}\n`;
    } else {
      text += `# Contact: ${email}\n`;
    }

    text += `\n## Meeting History (${meetings.length})\n`;
    for (const m of meetings) {
      text += `- [${m.date}] ${m.title} (${m.platform || 'Unknown'}) - ID: ${m.id}\n`;
    }

    return { content: [{ type: 'text', text }] };
  }
);

// ===================================================================
// Tool 6: list_companies
// ===================================================================
server.registerTool(
  'list_companies',
  {
    description: 'List all companies/organizations with contact and meeting counts.',
    inputSchema: z.object({}),
  },
  async () => {
    const rows = db.prepare(`
      SELECT organization, COUNT(DISTINCT email) as contact_count,
        COUNT(DISTINCT meeting_id) as meeting_count
      FROM participants
      WHERE organization IS NOT NULL AND organization != ''
      GROUP BY organization
      ORDER BY meeting_count DESC
    `).all();

    // Also include DB-driven clients if available
    let clientRows = [];
    try {
      clientRows = db.prepare('SELECT * FROM clients ORDER BY name').all();
    } catch { /* clients table may not exist */ }

    let text = `# Companies (${rows.length} from meetings)\n\n`;
    for (const r of rows) {
      text += `- **${r.organization}** — ${r.contact_count} contacts, ${r.meeting_count} meetings\n`;
    }

    if (clientRows.length > 0) {
      text += `\n# Configured Clients (${clientRows.length})\n\n`;
      for (const c of clientRows) {
        let domains = '';
        try { domains = c.domains ? JSON.parse(c.domains).join(', ') : ''; } catch { /* ignore */ }
        text += `- **${c.name}** (${c.category || c.type}, ${c.status})${domains ? ` — ${domains}` : ''}\n`;
      }
    }

    return { content: [{ type: 'text', text }] };
  }
);

// ===================================================================
// Tool 7: get_company
// ===================================================================
server.registerTool(
  'get_company',
  {
    description: 'Get company details with contacts and recent meetings.',
    inputSchema: z.object({
      company: z.string().describe('Company/organization name'),
    }),
  },
  async ({ company }) => {
    const contacts = db.prepare(`
      SELECT DISTINCT name, email
      FROM participants
      WHERE organization LIKE ?
    `).all(`%${company}%`);

    const meetings = db.prepare(`
      SELECT DISTINCT m.id, m.title, m.date, m.platform
      FROM meetings m
      JOIN participants p ON p.meeting_id = m.id
      WHERE p.organization LIKE ?
      ORDER BY m.date DESC
      LIMIT 50
    `).all(`%${company}%`);

    let text = `# ${company}\n\n`;
    text += `## Contacts (${contacts.length})\n`;
    for (const c of contacts) {
      text += `- ${c.name}${c.email ? ` (${c.email})` : ''}\n`;
    }

    text += `\n## Recent Meetings (${meetings.length})\n`;
    for (const m of meetings) {
      text += `- [${m.date}] ${m.title} — ID: ${m.id}\n`;
    }

    return { content: [{ type: 'text', text }] };
  }
);

// ===================================================================
// Tool 8: get_calendar_events
// ===================================================================
server.registerTool(
  'get_calendar_events',
  {
    description: 'Get meetings in a date range with coverage status (has notes or not).',
    inputSchema: z.object({
      startDate: z.string().describe('Start date (YYYY-MM-DD)'),
      endDate: z.string().describe('End date (YYYY-MM-DD)'),
    }),
  },
  async ({ startDate, endDate }) => {
    const meetings = db.prepare(
      'SELECT id, title, date, platform, status, calendar_event_id, summary FROM meetings WHERE date BETWEEN ? AND ? ORDER BY date'
    ).all(startDate, endDate);

    const withNotes = meetings.filter(m => m.summary);
    const withoutNotes = meetings.filter(m => !m.summary);
    const pct = meetings.length > 0 ? Math.round((withNotes.length / meetings.length) * 100) : 100;

    let text = `# Calendar Coverage: ${startDate} to ${endDate}\n\n`;
    text += `**Coverage:** ${pct}% (${withNotes.length}/${meetings.length} have notes)\n\n`;

    if (withoutNotes.length > 0) {
      text += `## Missing Notes (${withoutNotes.length})\n`;
      for (const m of withoutNotes) {
        text += `- [${m.date}] ${m.title} — ID: ${m.id}\n`;
      }
    }

    if (withNotes.length > 0) {
      text += `\n## With Notes (${withNotes.length})\n`;
      for (const m of withNotes) {
        text += `- [${m.date}] ${m.title} — ID: ${m.id}\n`;
      }
    }

    return { content: [{ type: 'text', text }] };
  }
);

// ===================================================================
// Tool 9: search_across_meetings
// ===================================================================
server.registerTool(
  'search_across_meetings',
  {
    description: 'Full-text search across meeting transcripts and summaries.',
    inputSchema: z.object({
      query: z.string().describe('Search text'),
      limit: z.number().optional().describe('Max results (default 10)'),
    }),
  },
  async ({ query, limit: maxResults }) => {
    const resultLimit = maxResults || 10;

    // Search in summaries
    const summaryMatches = db.prepare(`
      SELECT id, title, date, summary FROM meetings
      WHERE summary LIKE ? OR content LIKE ?
      ORDER BY date DESC LIMIT ?
    `).all(`%${query}%`, `%${query}%`, resultLimit);

    // Search in transcripts
    const transcriptMatches = db.prepare(`
      SELECT DISTINCT t.meeting_id, m.title, m.date, t.text, t.speaker
      FROM transcript_entries t
      JOIN meetings m ON m.id = t.meeting_id
      WHERE t.text LIKE ?
      ORDER BY m.date DESC LIMIT ?
    `).all(`%${query}%`, resultLimit);

    let text = `# Search Results for "${query}"\n\n`;

    if (summaryMatches.length > 0) {
      text += `## In Summaries (${summaryMatches.length})\n`;
      for (const m of summaryMatches) {
        text += `- [${m.date}] **${m.title}** — ID: ${m.id}\n`;
      }
    }

    if (transcriptMatches.length > 0) {
      text += `\n## In Transcripts (${transcriptMatches.length})\n`;
      for (const t of transcriptMatches) {
        const snippet = t.text.substring(0, 100);
        text += `- [${t.date}] **${t.title}** — ${t.speaker}: "${snippet}..." — ID: ${t.meeting_id}\n`;
      }
    }

    if (summaryMatches.length === 0 && transcriptMatches.length === 0) {
      text += 'No results found.\n';
    }

    return { content: [{ type: 'text', text }] };
  }
);

// ===================================================================
// Helper functions
// ===================================================================

function formatTimestamp(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ===================================================================
// Start server
// ===================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('JD Notes MCP server started\n');
}

main().catch(error => {
  process.stderr.write(`MCP server error: ${error.message}\n`);
  process.exit(1);
});
