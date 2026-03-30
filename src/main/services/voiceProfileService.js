/**
 * VoiceProfileService
 *
 * Wraps voice profile database operations and provides:
 *   - Embedding math: serialize/deserialize, cosine similarity/distance, weighted average
 *   - Profile CRUD backed by databaseService voice_profiles / voice_samples tables
 *   - AI service integration: embed-speakers + identify-speakers endpoints
 *   - Full speaker identification flow with auto-enrollment and confidence tiers
 */

const https = require('https');
const http = require('http');
const log = require('electron-log');

const LOG_PREFIX = '[VoiceProfileService]';

// ============================================================
// Constants
// ============================================================

/** Auto-apply match: distance ≤ this means high confidence */
const DISTANCE_HIGH_CONFIDENCE = 0.25;

/** Flag for human verification: distance ≤ this means medium confidence */
const DISTANCE_MEDIUM_CONFIDENCE = 0.45;

// ============================================================
// Pure math functions (exported for direct unit testing)
// ============================================================

/**
 * Serialize a Float32Array to a Buffer for SQLite BLOB storage.
 * Uses little-endian byte order.
 * @param {Float32Array} float32Array
 * @returns {Buffer}
 */
function serializeEmbedding(float32Array) {
  const buf = Buffer.allocUnsafe(float32Array.length * 4);
  for (let i = 0; i < float32Array.length; i++) {
    buf.writeFloatLE(float32Array[i], i * 4);
  }
  return buf;
}

/**
 * Deserialize a Buffer (from SQLite BLOB) back to a Float32Array.
 * Expects little-endian byte order.
 * @param {Buffer} buffer
 * @returns {Float32Array}
 */
function deserializeEmbedding(buffer) {
  const len = buffer.length / 4;
  const arr = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    arr[i] = buffer.readFloatLE(i * 4);
  }
  return arr;
}

/**
 * Compute cosine similarity between two Float32Arrays.
 * Returns a value in [-1, 1]. Returns 0 if either vector has zero magnitude.
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number}
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Compute cosine distance between two Float32Arrays.
 * Returns a value in [0, 2]. Smaller = more similar.
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number}
 */
function cosineDistance(a, b) {
  return 1 - cosineSimilarity(a, b);
}

/**
 * Compute a weighted average embedding from multiple samples, weighted by duration,
 * then L2-normalize the result.
 *
 * @param {Array<{ embedding: Float32Array, duration: number }>} samples
 * @returns {Float32Array} L2-normalized weighted average
 */
function weightedAverageEmbedding(samples) {
  if (samples.length === 0) {
    throw new Error('weightedAverageEmbedding requires at least one sample');
  }

  // Single sample: just L2-normalize
  if (samples.length === 1) {
    return _l2Normalize(new Float32Array(samples[0].embedding));
  }

  const dim = samples[0].embedding.length;
  const sum = new Float64Array(dim); // use float64 for accumulation precision
  let totalWeight = 0;

  for (const sample of samples) {
    const weight = sample.duration > 0 ? sample.duration : 1;
    totalWeight += weight;
    for (let i = 0; i < dim; i++) {
      sum[i] += sample.embedding[i] * weight;
    }
  }

  const avg = new Float32Array(dim);
  for (let i = 0; i < dim; i++) {
    avg[i] = sum[i] / totalWeight;
  }

  return _l2Normalize(avg);
}

/**
 * L2-normalize a Float32Array in-place and return it.
 * @param {Float32Array} arr
 * @returns {Float32Array}
 */
function _l2Normalize(arr) {
  let mag = 0;
  for (let i = 0; i < arr.length; i++) {
    mag += arr[i] * arr[i];
  }
  mag = Math.sqrt(mag);
  if (mag === 0) return arr;
  for (let i = 0; i < arr.length; i++) {
    arr[i] /= mag;
  }
  return arr;
}

// ============================================================
// VoiceProfileService class
// ============================================================

class VoiceProfileService {
  /**
   * @param {Object} databaseService - Instance of DatabaseService with voice profile methods
   */
  constructor(databaseService) {
    this.db = databaseService;
    this.aiServiceUrl = 'http://localhost:8374';
  }

  /**
   * Set the AI service base URL.
   * @param {string} url - e.g. 'http://localhost:8374'
   */
  setAIServiceUrl(url) {
    this.aiServiceUrl = url;
  }

  // ============================================================
  // Profile CRUD
  // ============================================================

  /**
   * Save (insert or update) a voice profile.
   * Converts Float32Array embedding to Buffer before persisting.
   *
   * @param {Object} profile
   * @param {number} [profile.id] - If provided, updates existing profile
   * @param {string} [profile.googleContactId]
   * @param {string} profile.contactName
   * @param {string} [profile.contactEmail]
   * @param {Float32Array} profile.embedding
   * @param {number} [profile.sampleCount]
   * @param {number} [profile.totalDuration]
   * @param {number} [profile.confidence]
   * @returns {{ id: number }}
   */
  saveProfile(profile) {
    const embeddingBuffer = serializeEmbedding(profile.embedding);
    const dbProfile = {
      googleContactId: profile.googleContactId || null,
      contactName: profile.contactName,
      contactEmail: profile.contactEmail || null,
      embedding: embeddingBuffer,
      sampleCount: profile.sampleCount ?? 1,
      totalDuration: profile.totalDuration ?? 0,
      confidence: profile.confidence ?? 0.5,
    };

    if (profile.id != null) {
      return this.db.saveVoiceProfile(dbProfile, profile.id);
    }
    return this.db.saveVoiceProfile(dbProfile);
  }

  /**
   * Get a voice profile by id, converting Buffer embedding → Float32Array.
   * @param {number} id
   * @returns {Object|null}
   */
  getProfile(id) {
    const row = this.db.getVoiceProfile(id);
    if (!row) return null;
    return this._rowToProfile(row);
  }

  /**
   * Get a voice profile by contact email.
   * @param {string} email
   * @returns {Object|null}
   */
  getProfileByEmail(email) {
    const row = this.db.getVoiceProfileByEmail(email);
    if (!row) return null;
    return this._rowToProfile(row);
  }

  /**
   * Get a voice profile by Google Contact ID.
   * @param {string} googleContactId
   * @returns {Object|null}
   */
  getProfileByContact(googleContactId) {
    const row = this.db.getVoiceProfileByContact(googleContactId);
    if (!row) return null;
    return this._rowToProfile(row);
  }

  /**
   * Get all voice profiles, with embeddings deserialized to Float32Array.
   * @returns {Array}
   */
  getAllProfiles() {
    const rows = this.db.getAllVoiceProfiles();
    return rows.map(r => this._rowToProfile(r));
  }

  /**
   * Delete a voice profile and all its samples.
   * @param {number} id
   * @returns {boolean}
   */
  deleteProfile(id) {
    return this.db.deleteVoiceProfile(id);
  }

  // ============================================================
  // Voice Samples
  // ============================================================

  /**
   * Add a voice sample to a profile.
   * @param {number} profileId
   * @param {string|null} meetingId
   * @param {Float32Array} embedding
   * @param {number} duration - Duration in seconds
   * @returns {{ id: number }}
   */
  addSample(profileId, meetingId, embedding, duration) {
    const embeddingBuffer = serializeEmbedding(embedding);
    return this.db.addVoiceSample(profileId, {
      meetingId: meetingId || null,
      embedding: embeddingBuffer,
      duration: duration ?? 0,
    });
  }

  /**
   * Get all voice samples for a profile, with embeddings deserialized to Float32Array.
   * @param {number} profileId
   * @returns {Array<{ id, profileId, meetingId, embedding: Float32Array, duration, createdAt }>}
   */
  getSamples(profileId) {
    const rows = this.db.getVoiceSamples(profileId);
    return rows.map(r => ({
      id: r.id,
      profileId: r.profile_id,
      meetingId: r.meeting_id || null,
      embedding: deserializeEmbedding(r.embedding),
      duration: r.duration ?? 0,
      createdAt: r.created_at,
    }));
  }

  // ============================================================
  // Profile Recomputation
  // ============================================================

  /**
   * Re-average all voice samples for a profile weighted by duration,
   * update the stored embedding and recalculate confidence.
   *
   * Confidence formula: 0.5 + 0.05 * sampleCount, capped at 0.95.
   *
   * @param {number} profileId
   * @returns {boolean} True if recomputed, false if no samples found
   */
  recomputeProfile(profileId) {
    const samples = this.getSamples(profileId);
    if (samples.length === 0) {
      log.warn(`${LOG_PREFIX} recomputeProfile: no samples for profile ${profileId}`);
      return false;
    }

    const avgEmbedding = weightedAverageEmbedding(samples);
    const sampleCount = samples.length;
    const totalDuration = samples.reduce((sum, s) => sum + (s.duration ?? 0), 0);
    const confidence = Math.min(0.5 + 0.05 * sampleCount, 0.95);

    const existing = this.getProfile(profileId);
    if (!existing) {
      log.warn(`${LOG_PREFIX} recomputeProfile: profile ${profileId} not found`);
      return false;
    }

    this.saveProfile({
      ...existing,
      embedding: avgEmbedding,
      sampleCount,
      totalDuration,
      confidence,
    });

    log.info(`${LOG_PREFIX} Recomputed profile ${profileId}: ${sampleCount} samples, confidence=${confidence.toFixed(3)}`);
    return true;
  }

  // ============================================================
  // Matching
  // ============================================================

  /**
   * Find the best matching profile for an embedding.
   * Returns null if no profiles exist.
   *
   * @param {Float32Array} embedding
   * @returns {{ profile: Object, distance: number, confidence: string }|null}
   *   confidence is 'high' | 'medium' | 'low'
   */
  findBestMatch(embedding) {
    const profiles = this.getAllProfiles();
    if (profiles.length === 0) return null;

    let bestProfile = null;
    let bestDistance = Infinity;

    for (const profile of profiles) {
      const dist = cosineDistance(embedding, profile.embedding);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestProfile = profile;
      }
    }

    let confidenceLevel;
    if (bestDistance <= DISTANCE_HIGH_CONFIDENCE) {
      confidenceLevel = 'high';
    } else if (bestDistance <= DISTANCE_MEDIUM_CONFIDENCE) {
      confidenceLevel = 'medium';
    } else {
      confidenceLevel = 'low';
    }

    return {
      profile: bestProfile,
      distance: bestDistance,
      confidence: confidenceLevel,
    };
  }

  // ============================================================
  // AI Service Calls
  // ============================================================

  /**
   * Call the AI service to get embeddings for speakers in an audio file.
   * POST /embed-speakers, 30s timeout.
   *
   * @param {string} audioFilePath - Absolute path to audio file
   * @param {Array<{ speakerLabel: string, startMs: number, endMs: number }>} segments
   * @returns {Promise<Array<{ speakerLabel: string, embedding: Float32Array }>>}
   */
  async embedSpeakers(audioFilePath, segments) {
    const body = JSON.stringify({ audioFilePath, segments });
    const result = await this._postJson('/embed-speakers', body, 30000);

    // AI service returns embedding as number[], convert to Float32Array
    return (result.speakers || []).map(s => ({
      speakerLabel: s.speakerLabel,
      embedding: new Float32Array(s.embedding),
    }));
  }

  /**
   * Call the AI service to identify speakers given embeddings and known profiles.
   * POST /identify-speakers, 5s timeout.
   *
   * @param {Array<{ speakerLabel: string, embedding: Float32Array }>} embeddings
   * @param {Array<Object>} profiles - Voice profiles with embeddings
   * @returns {Promise<Array<{ speakerLabel: string, profileId: number|null, distance: number }>>}
   */
  async identifySpeakersRemote(embeddings, profiles) {
    const payload = {
      embeddings: embeddings.map(e => ({
        speakerLabel: e.speakerLabel,
        embedding: Array.from(e.embedding),
      })),
      profiles: profiles.map(p => ({
        id: p.id,
        contactName: p.contactName,
        embedding: Array.from(p.embedding),
      })),
    };
    const result = await this._postJson('/identify-speakers', JSON.stringify(payload), 5000);
    return result.matches || [];
  }

  /**
   * Full speaker identification flow:
   *   1. Get embeddings from AI service
   *   2. Match against stored profiles (high confidence → auto-apply + update; medium → flag)
   *   3. Hybrid enrollment: if exactly 1 unmatched attendee, auto-enroll; else mark unmatched
   *
   * @param {string} audioFilePath
   * @param {Array<{ speakerLabel: string, startMs: number, endMs: number }>} segments
   * @param {Array<{ name: string, email: string, googleContactId?: string }>} calendarAttendees
   * @param {string} meetingId
   * @returns {Promise<Array<{
   *   speakerLabel: string,
   *   profileId: number|null,
   *   contactName: string|null,
   *   contactEmail: string|null,
   *   confidence: string,
   *   distance: number,
   *   status: 'auto-matched' | 'pending-review' | 'auto-enrolled' | 'unmatched',
   *   candidates?: Array<Object>
   * }>>}
   */
  async identifySpeakers(audioFilePath, segments, calendarAttendees, meetingId) {
    log.info(`${LOG_PREFIX} identifySpeakers: ${segments.length} segments, ${calendarAttendees.length} attendees`);

    // Step 1: Get embeddings from AI service
    let speakerEmbeddings;
    try {
      speakerEmbeddings = await this.embedSpeakers(audioFilePath, segments);
    } catch (err) {
      log.error(`${LOG_PREFIX} embedSpeakers failed:`, err.message);
      throw err;
    }

    // Step 2: Match each speaker against stored profiles
    const results = [];
    const unmatchedSpeakers = [];

    for (const speaker of speakerEmbeddings) {
      const match = this.findBestMatch(speaker.embedding);

      if (match && match.confidence === 'high') {
        // Auto-apply: update the profile with this new sample
        const profile = match.profile;
        const duration = this._segmentDuration(segments, speaker.speakerLabel);
        this.addSample(profile.id, meetingId, speaker.embedding, duration);
        this.recomputeProfile(profile.id);

        log.info(
          `${LOG_PREFIX} Auto-matched ${speaker.speakerLabel} → ${profile.contactName} (dist=${match.distance.toFixed(4)})`
        );

        results.push({
          speakerLabel: speaker.speakerLabel,
          profileId: profile.id,
          contactName: profile.contactName,
          contactEmail: profile.contactEmail,
          confidence: 'high',
          distance: match.distance,
          status: 'auto-matched',
        });
      } else if (match && match.confidence === 'medium') {
        // Flag for human verification
        log.info(
          `${LOG_PREFIX} Medium-confidence match for ${speaker.speakerLabel} → ${match.profile.contactName} (dist=${match.distance.toFixed(4)})`
        );

        results.push({
          speakerLabel: speaker.speakerLabel,
          profileId: match.profile.id,
          contactName: match.profile.contactName,
          contactEmail: match.profile.contactEmail,
          confidence: 'medium',
          distance: match.distance,
          status: 'pending-review',
        });
      } else {
        // Low confidence or no profiles — needs enrollment
        unmatchedSpeakers.push({ speaker, match });
      }
    }

    // Step 3: Hybrid enrollment for unmatched speakers
    const unmatchedAttendees = calendarAttendees.filter(
      a => !results.some(r => r.contactEmail === a.email && r.status === 'auto-matched')
    );

    if (unmatchedSpeakers.length === 1 && unmatchedAttendees.length === 1) {
      // Exactly one unmatched speaker + one unmatched attendee → auto-enroll
      const { speaker } = unmatchedSpeakers[0];
      const attendee = unmatchedAttendees[0];
      const duration = this._segmentDuration(segments, speaker.speakerLabel);

      const { id: newProfileId } = this.saveProfile({
        googleContactId: attendee.googleContactId || null,
        contactName: attendee.name,
        contactEmail: attendee.email,
        embedding: speaker.embedding,
        sampleCount: 1,
        totalDuration: duration,
        confidence: 0.5,
      });

      this.addSample(newProfileId, meetingId, speaker.embedding, duration);

      log.info(
        `${LOG_PREFIX} Auto-enrolled ${speaker.speakerLabel} as ${attendee.name} (new profile ${newProfileId})`
      );

      results.push({
        speakerLabel: speaker.speakerLabel,
        profileId: newProfileId,
        contactName: attendee.name,
        contactEmail: attendee.email,
        confidence: 'enrolled',
        distance: unmatchedSpeakers[0].match ? unmatchedSpeakers[0].match.distance : null,
        status: 'auto-enrolled',
      });
    } else {
      // Multiple unmatched speakers or ambiguous — mark as unmatched with candidate list
      for (const { speaker, match } of unmatchedSpeakers) {
        const candidateProfiles = match ? [match.profile] : [];

        results.push({
          speakerLabel: speaker.speakerLabel,
          profileId: null,
          contactName: null,
          contactEmail: null,
          confidence: 'low',
          distance: match ? match.distance : null,
          status: 'unmatched',
          candidates: candidateProfiles.map(p => ({
            profileId: p.id,
            contactName: p.contactName,
            contactEmail: p.contactEmail,
          })),
        });
      }
    }

    return results;
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  /**
   * Convert a raw database row to a profile object with Float32Array embedding.
   * @param {Object} row - Raw SQLite row
   * @returns {Object}
   */
  _rowToProfile(row) {
    return {
      id: row.id,
      googleContactId: row.google_contact_id || null,
      contactName: row.contact_name,
      contactEmail: row.contact_email || null,
      embedding: deserializeEmbedding(row.embedding),
      sampleCount: row.sample_count ?? 0,
      totalDuration: row.total_duration ?? 0,
      confidence: row.confidence ?? 0.5,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Total duration for a speaker label from the segments array.
   * @param {Array} segments
   * @param {string} speakerLabel
   * @returns {number} Duration in seconds
   */
  _segmentDuration(segments, speakerLabel) {
    return segments
      .filter(s => s.speakerLabel === speakerLabel)
      .reduce((sum, s) => sum + Math.max(0, (s.endMs - s.startMs) / 1000), 0);
  }

  /**
   * Make a POST request to the AI service with JSON body.
   * @param {string} path - URL path (e.g. '/embed-speakers')
   * @param {string} body - JSON string
   * @param {number} timeoutMs
   * @returns {Promise<Object>} Parsed JSON response
   */
  _postJson(path, body, timeoutMs) {
    return new Promise((resolve, reject) => {
      const url = new URL(this.aiServiceUrl + path);
      const transport = url.protocol === 'https:' ? https : http;

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      };

      const req = transport.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(data));
            } else {
              reject(new Error(`AI service error ${res.statusCode}: ${data}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse AI service response: ${e.message}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`AI service request timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => {
        reject(new Error(`AI service request failed: ${err.message}`));
      });

      req.write(body);
      req.end();
    });
  }
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  VoiceProfileService,
  serializeEmbedding,
  deserializeEmbedding,
  cosineSimilarity,
  cosineDistance,
  weightedAverageEmbedding,
  DISTANCE_HIGH_CONFIDENCE,
  DISTANCE_MEDIUM_CONFIDENCE,
};
