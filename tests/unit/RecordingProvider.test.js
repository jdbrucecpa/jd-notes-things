import { describe, it, expect } from 'vitest';
import { RecordingProvider } from '../../src/main/recording/RecordingProvider.js';

describe('RecordingProvider', () => {
  it('is an EventEmitter', () => {
    const provider = new RecordingProvider();
    expect(typeof provider.on).toBe('function');
    expect(typeof provider.emit).toBe('function');
  });

  it('throws on unimplemented initialize', async () => {
    const provider = new RecordingProvider();
    await expect(provider.initialize({})).rejects.toThrow('must implement');
  });

  it('throws on unimplemented startRecording', async () => {
    const provider = new RecordingProvider();
    await expect(provider.startRecording({})).rejects.toThrow('must implement');
  });

  it('throws on unimplemented stopRecording', async () => {
    const provider = new RecordingProvider();
    await expect(provider.stopRecording('id')).rejects.toThrow('must implement');
  });

  it('throws on unimplemented shutdown', async () => {
    const provider = new RecordingProvider();
    await expect(provider.shutdown()).rejects.toThrow('must implement');
  });

  it('has getState returning default state', () => {
    const provider = new RecordingProvider();
    const state = provider.getState();
    expect(state.recording).toBe(false);
    expect(state.meetingDetected).toBe(false);
  });
});
