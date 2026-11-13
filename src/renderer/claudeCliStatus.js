/**
 * Status line for the "Use Claude subscription" setting: says whether Claude
 * models currently run on the Claude plan (via Claude Code) or the API key.
 *
 * @param {{success: boolean, status?: Object, error?: string}} result - llm:getClaudeCliStatus reply
 * @param {Date} [now]
 * @returns {{text: string, state: '' | 'connected' | 'checking' | 'disconnected'}}
 *   state is a .service-status modifier class ('' = neutral, no dot colour)
 */
export function describeClaudeCliStatus(result, now = new Date()) {
  if (!result?.success || !result.status) {
    return { text: 'Status unavailable', state: 'disconnected' };
  }
  const s = result.status;
  const apiFallback = s.apiKeyConfigured
    ? 'using your Anthropic API key'
    : 'no Anthropic API key, so Claude models are unavailable';

  if (!s.supported) {
    return { text: 'Not supported in this build', state: '' };
  }
  if (!s.enabled) {
    return { text: `Off: ${apiFallback}`, state: '' };
  }
  if (s.usable) {
    return {
      text: `Using your Claude subscription${
        s.apiKeyConfigured ? ' (API key as fallback)' : ' (no API key fallback)'
      }`,
      state: 'connected',
    };
  }
  if (s.cooldownUntil) {
    const minutes = Math.max(1, Math.ceil((s.cooldownUntil - now.getTime()) / 60000));
    return {
      text: `Paused for ${minutes} min after an error (${s.lastError}): ${apiFallback}`,
      state: 'checking',
    };
  }
  return {
    text: `Not available (${s.reason || 'unknown'}): ${apiFallback}`,
    state: 'disconnected',
  };
}
