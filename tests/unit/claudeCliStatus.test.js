import { describe, it, expect } from 'vitest';
import { describeClaudeCliStatus } from '../../src/renderer/claudeCliStatus.js';

const reply = status => ({
  success: true,
  status: { supported: true, enabled: true, apiKeyConfigured: true, ...status },
});

describe('describeClaudeCliStatus', () => {
  it('shows subscription use and whether the API key backs it up', () => {
    expect(describeClaudeCliStatus(reply({ usable: true }))).toEqual({
      text: 'Using your Claude subscription (API key as fallback)',
      state: 'connected',
    });
    expect(describeClaudeCliStatus(reply({ usable: true, apiKeyConfigured: false })).text).toBe(
      'Using your Claude subscription (no API key fallback)'
    );
  });

  it('explains why the subscription is not in use', () => {
    expect(
      describeClaudeCliStatus(reply({ usable: false, reason: 'Claude Code is not installed' }))
    ).toEqual({
      text: 'Not available (Claude Code is not installed): using your Anthropic API key',
      state: 'disconnected',
    });
  });

  it('shows the error pause with minutes remaining', () => {
    const now = new Date(1_000_000);
    const { text, state } = describeClaudeCliStatus(
      reply({ usable: false, cooldownUntil: 1_000_000 + 9.5 * 60000, lastError: 'HTTP 429' }),
      now
    );
    expect(text).toBe('Paused for 10 min after an error (HTTP 429): using your Anthropic API key');
    expect(state).toBe('checking');
  });

  it('handles the setting being off, with and without an API key', () => {
    expect(describeClaudeCliStatus(reply({ enabled: false })).text).toBe(
      'Off: using your Anthropic API key'
    );
    expect(describeClaudeCliStatus(reply({ enabled: false, apiKeyConfigured: false })).text).toBe(
      'Off: no Anthropic API key, so Claude models are unavailable'
    );
  });

  it('handles a failed IPC call', () => {
    expect(describeClaudeCliStatus({ success: false, error: 'x' })).toEqual({
      text: 'Status unavailable',
      state: 'disconnected',
    });
    expect(describeClaudeCliStatus(null).state).toBe('disconnected');
  });
});
