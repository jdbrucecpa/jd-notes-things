import { describe, it, expect } from 'vitest';
import { reconcileAiServicePath } from '../../src/renderer/servicePathSync.js';

// Pre-2.0.3 installs have the AI service path in renderer localStorage but
// not in the main process's app-settings.json (the input change event that
// forwards it never fired after the hardcoded defaults were removed).
// reconcileAiServicePath decides which store wins at settings-UI startup.
describe('reconcileAiServicePath', () => {
  it('pushes the renderer path to main when main has none (self-heal)', () => {
    expect(
      reconcileAiServicePath('', 'C:\\code\\jd-audio-service')
    ).toEqual({ action: 'push', path: 'C:\\code\\jd-audio-service' });
  });

  it('treats a missing main value like an empty one', () => {
    expect(
      reconcileAiServicePath(undefined, 'C:\\code\\jd-audio-service')
    ).toEqual({ action: 'push', path: 'C:\\code\\jd-audio-service' });
  });

  it('pulls the main path into the renderer when they differ', () => {
    expect(
      reconcileAiServicePath('D:\\real\\install', 'C:\\stale\\localstorage')
    ).toEqual({ action: 'pull', path: 'D:\\real\\install' });
  });

  it('does nothing when both stores agree', () => {
    expect(
      reconcileAiServicePath('C:\\code\\jd-audio-service', 'C:\\code\\jd-audio-service')
    ).toEqual({ action: 'none', path: 'C:\\code\\jd-audio-service' });
  });

  it('does nothing when neither store has a path', () => {
    expect(reconcileAiServicePath('', '')).toEqual({ action: 'none', path: '' });
    expect(reconcileAiServicePath(undefined, undefined)).toEqual({ action: 'none', path: '' });
  });

  it('ignores whitespace-only values', () => {
    expect(reconcileAiServicePath('  ', ' \t')).toEqual({ action: 'none', path: '' });
  });
});
