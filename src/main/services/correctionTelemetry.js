const fs = require('fs');
const path = require('path');

/**
 * Which corrections did the user actually make, relative to what the pipeline
 * guessed? Pure diff: prevMapping is meeting.speakerMapping (pipeline output),
 * newMappings is the Fix Speakers payload ({ label: { contactName, contactEmail } }).
 * Returns one record per label whose assigned person changed.
 */
function diffCorrections(meetingId, prevMapping, newMappings) {
  const out = [];
  if (!prevMapping || !newMappings) return out;
  for (const [label, next] of Object.entries(newMappings)) {
    if (!next || typeof next !== 'object') continue;
    const prev = prevMapping[label];
    if (!prev) continue;
    const prevName = (prev.name || '').toLowerCase();
    const prevEmail = (prev.email || '').toLowerCase();
    const nextName = (next.contactName || '').toLowerCase();
    const nextEmail = (next.contactEmail || '').toLowerCase();

    // Person-identity comparison: emails are authoritative when BOTH sides
    // have one; otherwise fall back to name equality. Supplying an email for
    // the same name is an enrichment, not a correction.
    let changed;
    if (prevEmail && nextEmail) {
      changed = prevEmail !== nextEmail;
    } else {
      changed = !!nextName && prevName !== nextName;
    }
    if (!changed) continue;
    out.push({
      at: new Date().toISOString(),
      meetingId,
      speakerLabel: label,
      fromName: prev.name || null,
      fromMethod: prev.method || 'unknown',
      fromConfidence: prev.confidence || 'unknown',
      toName: next.contactName || null,
      toEmail: next.contactEmail || null,
    });
  }
  return out;
}

/**
 * File-backed correction log. Each record says which pipeline stage
 * (`fromMethod`) produced a guess the user overrode — the tuning signal for
 * anchor/margin thresholds (spec §8).
 */
class CorrectionTelemetry {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: 1, corrections: [] };
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(parsed?.corrections)) this.data = parsed;
      }
    } catch {
      /* corrupt file — start fresh, never crash correction flow */
    }
  }

  record(corrections) {
    if (!corrections || corrections.length === 0) return;
    this.data.corrections.push(...corrections);
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {
      /* telemetry must never break the correction flow */
    }
  }

  getStats() {
    const byMethod = {};
    for (const c of this.data.corrections) {
      byMethod[c.fromMethod] = (byMethod[c.fromMethod] || 0) + 1;
    }
    return { total: this.data.corrections.length, byMethod };
  }
}

module.exports = { CorrectionTelemetry, diffCorrections };
