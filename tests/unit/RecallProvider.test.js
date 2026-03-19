import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecallProvider } from '../../src/main/recording/RecallProvider.js';

const mockSdk = {
  init: vi.fn(),
  shutdown: vi.fn().mockResolvedValue(undefined),
  prepareDesktopAudioRecording: vi.fn().mockResolvedValue('window-key-123'),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  addEventListener: vi.fn(),
};

describe('RecallProvider', () => {
  let provider;

  beforeEach(() => {
    vi.clearAllMocks();
    // restartDelayMs: 0 prevents the 3 s SDK-restart workaround from blocking tests
    provider = new RecallProvider(mockSdk, { restartDelayMs: 0 });
  });

  it('extends EventEmitter', () => {
    expect(typeof provider.on).toBe('function');
    expect(typeof provider.emit).toBe('function');
  });

  it('initialize calls SDK init and registers event handlers', async () => {
    await provider.initialize({ accessToken: 'test', userId: 'host' });
    expect(mockSdk.init).toHaveBeenCalled();
    expect(mockSdk.addEventListener).toHaveBeenCalled();
  });

  it('startRecording calls prepareDesktopAudioRecording', async () => {
    const recordingId = await provider.startRecording({
      windowId: 'w1',
      uploadToken: 'tok-123',
    });
    expect(mockSdk.prepareDesktopAudioRecording).toHaveBeenCalled();
    expect(mockSdk.startRecording).toHaveBeenCalled();
    expect(recordingId).toBe('window-key-123');
  });

  it('stopRecording calls SDK stopRecording', async () => {
    await provider.stopRecording('rec-123');
    expect(mockSdk.stopRecording).toHaveBeenCalledWith({ windowId: 'rec-123' });
  });

  it('shutdown calls SDK shutdown', async () => {
    await provider.shutdown();
    expect(mockSdk.shutdown).toHaveBeenCalled();
  });

  it('getState returns initial state', () => {
    const state = provider.getState();
    expect(state.recording).toBe(false);
    expect(state.sdkReady).toBe(false);
  });
});
