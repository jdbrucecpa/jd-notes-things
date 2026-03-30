/**
 * VoiceProfileService Unit Tests
 *
 * Tests:
 *   1. Embedding Serialization — round-trip Float32Array ↔ Buffer
 *   2. Cosine Distance / Similarity — known vector relationships
 *   3. Weighted Average Embedding — single sample, equal weights, duration bias
 *   4. VoiceProfileService CRUD — mock DB, Float32Array→Buffer conversion, findBestMatch
 */

const { describe, it, expect, vi, beforeEach } = await import('vitest');

const {
  VoiceProfileService,
  serializeEmbedding,
  deserializeEmbedding,
  cosineSimilarity,
  cosineDistance,
  weightedAverageEmbedding,
  DISTANCE_HIGH_CONFIDENCE,
  DISTANCE_MEDIUM_CONFIDENCE,
} = require('../../src/main/services/voiceProfileService.js');

// ============================================================
// Helpers
// ============================================================

/**
 * Build a normalized Float32Array pointing in a single dimension.
 * e.g. unitVector(4, 0) → [1, 0, 0, 0]
 */
function unitVector(dim, axis) {
  const v = new Float32Array(dim);
  v[axis] = 1.0;
  return v;
}

// ============================================================
// 1. Embedding Serialization
// ============================================================

describe('serializeEmbedding / deserializeEmbedding', () => {
  it('round-trips a 4-element Float32Array through Buffer', () => {
    const original = new Float32Array([1.0, -0.5, 0.25, 0.125]);
    const buf = serializeEmbedding(original);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(16); // 4 floats * 4 bytes

    const recovered = deserializeEmbedding(buf);
    expect(recovered).toBeInstanceOf(Float32Array);
    expect(recovered.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      expect(recovered[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('round-trips a 256-element Float32Array through Buffer', () => {
    const original = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      original[i] = (i / 256) * 2 - 1; // values in [-1, 1]
    }
    const buf = serializeEmbedding(original);
    expect(buf.length).toBe(1024); // 256 * 4

    const recovered = deserializeEmbedding(buf);
    expect(recovered.length).toBe(256);
    for (let i = 0; i < 256; i++) {
      expect(recovered[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('uses little-endian byte order', () => {
    // 1.0 in IEEE-754 little-endian is: 00 00 80 3F
    const v = new Float32Array([1.0]);
    const buf = serializeEmbedding(v);
    expect(buf[0]).toBe(0x00);
    expect(buf[1]).toBe(0x00);
    expect(buf[2]).toBe(0x80);
    expect(buf[3]).toBe(0x3f);
  });
});

// ============================================================
// 2. Cosine Distance / Similarity
// ============================================================

describe('cosineSimilarity / cosineDistance', () => {
  it('identical vectors have similarity 1 and distance 0', () => {
    const v = new Float32Array([1.0, 2.0, 3.0]);
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 6);
    expect(cosineDistance(v, v)).toBeCloseTo(0.0, 6);
  });

  it('opposite vectors have similarity -1 and distance 2', () => {
    const a = new Float32Array([1.0, 0.0, 0.0]);
    const b = new Float32Array([-1.0, 0.0, 0.0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0, 6);
    expect(cosineDistance(a, b)).toBeCloseTo(2.0, 6);
  });

  it('orthogonal vectors have similarity 0 and distance 1', () => {
    const a = unitVector(4, 0);
    const b = unitVector(4, 1);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0, 6);
    expect(cosineDistance(a, b)).toBeCloseTo(1.0, 6);
  });

  it('returns 0 similarity for zero vector', () => {
    const zero = new Float32Array([0.0, 0.0, 0.0]);
    const v = new Float32Array([1.0, 0.0, 0.0]);
    expect(cosineSimilarity(zero, v)).toBe(0);
  });

  it('distance is always in [0, 2] for random vectors', () => {
    const a = new Float32Array([0.3, -0.7, 0.1, 0.9]);
    const b = new Float32Array([-0.5, 0.2, 0.8, -0.1]);
    const dist = cosineDistance(a, b);
    expect(dist).toBeGreaterThanOrEqual(0);
    expect(dist).toBeLessThanOrEqual(2);
  });
});

// ============================================================
// 3. Weighted Average Embedding
// ============================================================

describe('weightedAverageEmbedding', () => {
  it('single sample: returns L2-normalized version of that embedding', () => {
    const embedding = new Float32Array([3.0, 4.0]); // magnitude 5
    const result = weightedAverageEmbedding([{ embedding, duration: 1.0 }]);
    expect(result[0]).toBeCloseTo(0.6, 5);
    expect(result[1]).toBeCloseTo(0.8, 5);
  });

  it('two equal-duration samples: averages the embeddings', () => {
    const a = new Float32Array([1.0, 0.0]);
    const b = new Float32Array([0.0, 1.0]);
    const samples = [
      { embedding: a, duration: 1.0 },
      { embedding: b, duration: 1.0 },
    ];
    const result = weightedAverageEmbedding(samples);
    // avg = [0.5, 0.5], normalized = [1/√2, 1/√2]
    expect(result[0]).toBeCloseTo(1 / Math.sqrt(2), 5);
    expect(result[1]).toBeCloseTo(1 / Math.sqrt(2), 5);
  });

  it('duration-weighted bias: longer sample dominates', () => {
    // Sample A pointing along x=1 with duration 3, sample B along y=1 with duration 1
    // Weighted avg: [3, 1], normalized: [3/√10, 1/√10]
    const a = new Float32Array([1.0, 0.0]);
    const b = new Float32Array([0.0, 1.0]);
    const samples = [
      { embedding: a, duration: 3.0 },
      { embedding: b, duration: 1.0 },
    ];
    const result = weightedAverageEmbedding(samples);
    const mag = Math.sqrt(10);
    expect(result[0]).toBeCloseTo(3 / mag, 4);
    expect(result[1]).toBeCloseTo(1 / mag, 4);
  });

  it('result is unit-normalized (L2 norm ≈ 1)', () => {
    const samples = [
      { embedding: new Float32Array([1.0, 2.0, 3.0]), duration: 2.0 },
      { embedding: new Float32Array([4.0, 5.0, 6.0]), duration: 3.0 },
    ];
    const result = weightedAverageEmbedding(samples);
    let mag = 0;
    for (let i = 0; i < result.length; i++) mag += result[i] * result[i];
    expect(Math.sqrt(mag)).toBeCloseTo(1.0, 5);
  });

  it('zero-duration samples treated as weight 1', () => {
    const a = new Float32Array([1.0, 0.0]);
    const b = new Float32Array([0.0, 1.0]);
    const samples = [
      { embedding: a, duration: 0 },
      { embedding: b, duration: 0 },
    ];
    const result = weightedAverageEmbedding(samples);
    // Both get weight 1, same as equal-duration case
    expect(result[0]).toBeCloseTo(1 / Math.sqrt(2), 5);
    expect(result[1]).toBeCloseTo(1 / Math.sqrt(2), 5);
  });

  it('throws for empty samples array', () => {
    expect(() => weightedAverageEmbedding([])).toThrow();
  });
});

// ============================================================
// 4. VoiceProfileService CRUD (mock DB)
// ============================================================

describe('VoiceProfileService CRUD', () => {
  let service;
  let mockDb;

  /**
   * Build a mock DB row for a voice profile (as better-sqlite3 would return it).
   */
  function makeProfileRow(id, contactName, embedding, opts = {}) {
    return {
      id,
      google_contact_id: opts.googleContactId || null,
      contact_name: contactName,
      contact_email: opts.contactEmail || null,
      embedding: serializeEmbedding(embedding),
      sample_count: opts.sampleCount ?? 1,
      total_duration: opts.totalDuration ?? 0,
      confidence: opts.confidence ?? 0.5,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
  }

  beforeEach(() => {
    mockDb = {
      saveVoiceProfile: vi.fn(),
      getVoiceProfile: vi.fn(),
      getVoiceProfileByEmail: vi.fn(),
      getVoiceProfileByContact: vi.fn(),
      getAllVoiceProfiles: vi.fn(),
      deleteVoiceProfile: vi.fn(),
      addVoiceSample: vi.fn(),
      getVoiceSamples: vi.fn(),
    };
    service = new VoiceProfileService(mockDb);
  });

  // --- saveProfile converts Float32Array → Buffer ---

  it('saveProfile passes Buffer (not Float32Array) to db.saveVoiceProfile', () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    mockDb.saveVoiceProfile.mockReturnValue({ id: 1 });

    service.saveProfile({ contactName: 'Test User', embedding });

    expect(mockDb.saveVoiceProfile).toHaveBeenCalledTimes(1);
    const [dbProfile] = mockDb.saveVoiceProfile.mock.calls[0];
    expect(dbProfile.embedding).toBeInstanceOf(Buffer);
    expect(dbProfile.embedding.length).toBe(16); // 4 floats * 4 bytes
  });

  it('saveProfile with id calls db.saveVoiceProfile with second argument = id', () => {
    const embedding = new Float32Array([0.5, 0.5]);
    mockDb.saveVoiceProfile.mockReturnValue({ id: 42 });

    service.saveProfile({ id: 42, contactName: 'Updated User', embedding });

    expect(mockDb.saveVoiceProfile).toHaveBeenCalledTimes(1);
    const [dbProfile, idArg] = mockDb.saveVoiceProfile.mock.calls[0];
    // Service passes camelCase fields to databaseService (not snake_case)
    expect(dbProfile.contactName).toBe('Updated User');
    expect(dbProfile.embedding).toBeInstanceOf(Buffer);
    // Second argument must be the profile id
    expect(idArg).toBe(42);
  });

  // --- getProfile deserializes Buffer → Float32Array ---

  it('getProfile deserializes DB Buffer embedding back to Float32Array', () => {
    const originalEmbedding = new Float32Array([0.1, 0.9, 0.5]);
    mockDb.getVoiceProfile.mockReturnValue(
      makeProfileRow(1, 'Alice', originalEmbedding)
    );

    const profile = service.getProfile(1);

    expect(profile).not.toBeNull();
    expect(profile.embedding).toBeInstanceOf(Float32Array);
    expect(profile.embedding.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(profile.embedding[i]).toBeCloseTo(originalEmbedding[i], 5);
    }
  });

  it('getProfile returns null when db returns null', () => {
    mockDb.getVoiceProfile.mockReturnValue(null);
    expect(service.getProfile(999)).toBeNull();
  });

  it('_rowToProfile maps snake_case DB columns to camelCase', () => {
    const embedding = new Float32Array([1.0, 0.0]);
    const row = makeProfileRow(5, 'Bob', embedding, {
      googleContactId: 'contact-123',
      contactEmail: 'bob@example.com',
      sampleCount: 3,
      totalDuration: 45.5,
      confidence: 0.8,
    });

    const profile = service._rowToProfile(row);

    expect(profile.id).toBe(5);
    expect(profile.googleContactId).toBe('contact-123');
    expect(profile.contactName).toBe('Bob');
    expect(profile.contactEmail).toBe('bob@example.com');
    expect(profile.sampleCount).toBe(3);
    expect(profile.totalDuration).toBe(45.5);
    expect(profile.confidence).toBe(0.8);
    expect(profile.embedding).toBeInstanceOf(Float32Array);
  });

  // --- getAllProfiles ---

  it('getAllProfiles returns empty array when no profiles', () => {
    mockDb.getAllVoiceProfiles.mockReturnValue([]);
    expect(service.getAllProfiles()).toEqual([]);
  });

  it('getAllProfiles deserializes all embeddings', () => {
    const emb1 = new Float32Array([1.0, 0.0]);
    const emb2 = new Float32Array([0.0, 1.0]);
    mockDb.getAllVoiceProfiles.mockReturnValue([
      makeProfileRow(1, 'Alice', emb1),
      makeProfileRow(2, 'Bob', emb2),
    ]);

    const profiles = service.getAllProfiles();
    expect(profiles).toHaveLength(2);
    expect(profiles[0].embedding).toBeInstanceOf(Float32Array);
    expect(profiles[1].embedding).toBeInstanceOf(Float32Array);
  });

  // --- findBestMatch ---

  it('findBestMatch returns null when no profiles exist', () => {
    mockDb.getAllVoiceProfiles.mockReturnValue([]);
    const query = new Float32Array([0.5, 0.5]);
    expect(service.findBestMatch(query)).toBeNull();
  });

  it('findBestMatch returns high confidence for nearly identical vector', () => {
    // Profile embedding: unit vector along x
    const profileEmb = unitVector(4, 0);
    mockDb.getAllVoiceProfiles.mockReturnValue([
      makeProfileRow(1, 'Alice', profileEmb),
    ]);

    // Query is the same vector
    const result = service.findBestMatch(unitVector(4, 0));

    expect(result).not.toBeNull();
    expect(result.profile.id).toBe(1);
    expect(result.distance).toBeCloseTo(0, 5);
    expect(result.confidence).toBe('high');
  });

  it('findBestMatch returns low confidence for dissimilar vector', () => {
    // Profile along x, query along y — orthogonal → distance = 1
    const profileEmb = unitVector(4, 0);
    mockDb.getAllVoiceProfiles.mockReturnValue([
      makeProfileRow(1, 'Alice', profileEmb),
    ]);

    const result = service.findBestMatch(unitVector(4, 1));

    expect(result).not.toBeNull();
    expect(result.distance).toBeCloseTo(1.0, 5);
    expect(result.confidence).toBe('low');
  });

  it('findBestMatch selects the profile with smallest distance', () => {
    const close = unitVector(4, 0);
    const far = unitVector(4, 1);
    mockDb.getAllVoiceProfiles.mockReturnValue([
      makeProfileRow(1, 'Alice', close),
      makeProfileRow(2, 'Bob', far),
    ]);

    // Query is along x — should match Alice (distance ~0)
    const result = service.findBestMatch(unitVector(4, 0));
    expect(result.profile.contactName).toBe('Alice');
  });

  it('findBestMatch returns medium confidence for moderate distance', () => {
    // Create a vector at 45° from the query — distance = 1 - cos(45°) ≈ 0.293
    // DISTANCE_HIGH_CONFIDENCE = 0.25, DISTANCE_MEDIUM_CONFIDENCE = 0.45
    const profileEmb = new Float32Array([1.0, 1.0, 0.0, 0.0]); // normalized by service
    mockDb.getAllVoiceProfiles.mockReturnValue([
      makeProfileRow(1, 'Alice', profileEmb),
    ]);

    // Query along x axis
    const query = unitVector(4, 0);
    const result = service.findBestMatch(query);

    // dist = 1 - 1/√2 ≈ 0.293, which is > 0.25 and < 0.45
    expect(result.confidence).toBe('medium');
    expect(result.distance).toBeGreaterThan(DISTANCE_HIGH_CONFIDENCE);
    expect(result.distance).toBeLessThanOrEqual(DISTANCE_MEDIUM_CONFIDENCE);
  });

  // --- Constants ---

  it('exports the expected distance constants', () => {
    expect(DISTANCE_HIGH_CONFIDENCE).toBe(0.25);
    expect(DISTANCE_MEDIUM_CONFIDENCE).toBe(0.45);
  });

  // --- addSample ---

  it('addSample converts Float32Array embedding to Buffer', () => {
    const embedding = new Float32Array([0.1, 0.2, 0.3]);
    mockDb.addVoiceSample.mockReturnValue({ id: 10 });

    service.addSample(1, 'meeting-abc', embedding, 12.5);

    expect(mockDb.addVoiceSample).toHaveBeenCalledTimes(1);
    const [profileId, sample] = mockDb.addVoiceSample.mock.calls[0];
    expect(profileId).toBe(1);
    expect(sample.embedding).toBeInstanceOf(Buffer);
    expect(sample.duration).toBe(12.5);
    expect(sample.meetingId).toBe('meeting-abc');
  });

  // --- getSamples ---

  it('getSamples deserializes Buffer embeddings in samples', () => {
    const emb = new Float32Array([0.7, 0.3]);
    mockDb.getVoiceSamples.mockReturnValue([
      {
        id: 1,
        profile_id: 5,
        meeting_id: 'mtg-1',
        embedding: serializeEmbedding(emb),
        duration: 8.0,
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);

    const samples = service.getSamples(5);
    expect(samples).toHaveLength(1);
    expect(samples[0].embedding).toBeInstanceOf(Float32Array);
    expect(samples[0].embedding[0]).toBeCloseTo(0.7, 5);
    expect(samples[0].duration).toBe(8.0);
  });
});
