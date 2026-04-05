import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    killed: false,
    on: vi.fn(),
    stderr: { on: vi.fn() },
    stdout: { on: vi.fn() },
    kill: vi.fn(),
  })),
}));

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { AIServiceManager } = await import('../../src/main/services/aiServiceManager.js');

describe('AIServiceManager', () => {
  let manager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new AIServiceManager();
  });

  it('starts with no child process', () => {
    expect(manager.isRunning()).toBe(false);
    expect(manager.getProcess()).toBeNull();
  });

  it('isRunning returns false when no process', () => {
    expect(manager.isRunning()).toBe(false);
  });

  it('setServicePath updates the path', () => {
    manager.setServicePath('/new/path');
    expect(manager.servicePath).toBe('/new/path');
  });

  it('setServiceUrl updates the url', () => {
    manager.setServiceUrl('http://localhost:9999');
    expect(manager.serviceUrl).toBe('http://localhost:9999');
  });

  it('shutdown kills the child process', () => {
    const mockKill = vi.fn();
    manager._process = { kill: mockKill, pid: 123, killed: false };
    manager.shutdown();
    expect(manager._process).toBeNull();
  });

  it('shutdown is safe to call with no process', () => {
    expect(() => manager.shutdown()).not.toThrow();
  });
});
