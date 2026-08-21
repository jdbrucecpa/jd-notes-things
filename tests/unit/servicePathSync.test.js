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

  // Bundled-audio-service migration (main.js) intentionally clears main's
  // aiServicePath and sets aiServicePathMigratedToBundled=true. Without this
  // flag, an empty main path always looked like the pre-2.0.3 self-heal case
  // and the stale renderer localStorage copy got pushed straight back in,
  // silently undoing the migration on every Settings open.
  describe('with the bundled migration flag', () => {
    it('clears the stale renderer copy instead of pushing it back when main was migrated', () => {
      expect(
        reconcileAiServicePath('', 'C:\\code\\jd-audio-service', true)
      ).toEqual({ action: 'clear', path: '' });
    });

    it('still pushes when main has no path and no migration has run', () => {
      expect(
        reconcileAiServicePath('', 'C:\\code\\jd-audio-service', false)
      ).toEqual({ action: 'push', path: 'C:\\code\\jd-audio-service' });
    });

    it('defaults to push behavior when the migrated flag is omitted', () => {
      expect(
        reconcileAiServicePath('', 'C:\\code\\jd-audio-service')
      ).toEqual({ action: 'push', path: 'C:\\code\\jd-audio-service' });
    });

    it('does nothing when migrated is true but the renderer has no stale value either', () => {
      expect(reconcileAiServicePath('', '', true)).toEqual({ action: 'none', path: '' });
    });

    it('still pulls main path when migrated is true but main has a value (override configured post-migration)', () => {
      expect(
        reconcileAiServicePath('D:\\real\\install', 'C:\\stale\\localstorage', true)
      ).toEqual({ action: 'pull', path: 'D:\\real\\install' });
    });
  });
});
