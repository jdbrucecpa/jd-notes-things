/**
 * Claude Code CLI bridge.
 *
 * Runs Claude completions through `claude -p` (Claude Code's headless mode) so
 * they draw from the user's Claude subscription instead of API credits. The
 * LLM service falls back to the Anthropic API when the CLI is missing, not
 * logged in to a subscription, or a call fails.
 *
 * Prompt layout (see buildCliPrompts): the transcript is the whole system
 * prompt, and everything that varies per call goes in the user message. Claude
 * Code caches the system prompt, so every call for the same meeting (content
 * pass, auto-summary, each template section) reads the transcript from cache.
 *
 * Isolation flags (see BASE_ARGS): no tools, no settings files (which also
 * keeps the user's personal ~/.claude/CLAUDE.md out of meeting summaries), no
 * MCP servers, no skills, and no saved session transcripts.
 */

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_CALL_TIMEOUT_MS = 10 * 60 * 1000;
const PROBE_TIMEOUT_MS = 20 * 1000;
/** How long a probe result is trusted before `claude auth status` runs again. */
const AVAILABLE_TTL_MS = 10 * 60 * 1000;
const UNAVAILABLE_TTL_MS = 60 * 1000;
/** After a failed CLI call, use the API for this long before trying the CLI again. */
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
const STDERR_LIMIT = 64 * 1024;

const DEFAULT_WORK_DIR = path.join(os.tmpdir(), 'jd-notes-claude-cli');

/**
 * Env vars removed from the child's environment. An API key or token makes the
 * CLI bill API credits instead of the subscription; the Bedrock/Vertex/Foundry
 * switches bill a cloud account; CLAUDECODE / CLAUDE_CODE_ENTRYPOINT mark a
 * nested session (set when the app is started from a Claude Code terminal).
 */
const STRIPPED_ENV_VARS = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
]);

const BASE_ARGS = [
  '-p',
  '--tools',
  '',
  '--setting-sources',
  '',
  '--strict-mcp-config',
  '--disable-slash-commands',
  '--no-session-persistence',
];

const TRANSCRIPT_SYSTEM_PREAMBLE =
  'You analyze meeting transcripts. The transcript for this conversation is below. ' +
  'The user message holds the instructions for each task: follow them exactly, ' +
  'including any output format they specify.';

const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.';

/** Result texts the CLI has used for "subscription limit reached" without flagging an error. */
const LIMIT_RESULT_PATTERNS = [
  /^claude ai usage limit reached/i,
  /^you(?:'|’)ve hit your (?:usage )?limit/i,
  /^usage limit reached/i,
];

class ClaudeCliError extends Error {
  constructor(message, { exitCode = null, stderr = '', apiErrorStatus = null } = {}) {
    super(message);
    this.name = 'ClaudeCliError';
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.apiErrorStatus = apiErrorStatus;
  }
}

/** Copy of env without the variables that would change billing or block nesting. */
function buildChildEnv(baseEnv = process.env) {
  const env = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    // Windows env names are case-insensitive, so compare upper-cased.
    if (!STRIPPED_ENV_VARS.has(key.toUpperCase())) env[key] = value;
  }
  return env;
}

function defaultIsFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Find the `claude` executable. JD_NOTES_CLAUDE_PATH overrides the search.
 * GUI apps (Start menu on Windows, Finder on macOS) don't always inherit the
 * shell's PATH, so the installers' default locations are checked too.
 * @returns {string|null}
 */
function resolveClaudeExecutable({
  env = process.env,
  platform = process.platform,
  homeDir = os.homedir(),
  isFile = defaultIsFile,
} = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix;

  const override = env.JD_NOTES_CLAUDE_PATH;
  if (override) return isFile(override) ? override : null;

  const pathDirs = (env.PATH || env.Path || '').split(p.delimiter).filter(Boolean);
  const candidates = [];

  if (platform === 'win32') {
    candidates.push(p.join(homeDir, '.local', 'bin', 'claude.exe')); // native installer
    for (const dir of pathDirs) candidates.push(p.join(dir, 'claude.exe'));
    for (const dir of pathDirs) candidates.push(p.join(dir, 'claude.cmd')); // npm global shim
    const appData = env.APPDATA || p.join(homeDir, 'AppData', 'Roaming');
    candidates.push(p.join(appData, 'npm', 'claude.cmd'));
  } else {
    for (const dir of pathDirs) candidates.push(p.join(dir, 'claude'));
    candidates.push(
      p.join(homeDir, '.local', 'bin', 'claude'),
      p.join(homeDir, '.claude', 'local', 'claude'),
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude'
    );
  }

  return candidates.find(candidate => isFile(candidate)) || null;
}

/** Quote one argument for a cmd.exe command line. */
function quoteForCmd(arg) {
  if (arg === '') return '""';
  if (!/[\s"&|<>^()%!,;=]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '""')}"`;
}

/**
 * Spawn the CLI. Node refuses to spawn .cmd/.bat files directly, so the npm
 * shim on Windows runs through cmd.exe with each argument quoted (an empty
 * argument such as `--tools ""` would otherwise vanish). windowsHide stops a
 * console window flashing up on every call.
 */
function spawnClaude(executable, args, { cwd, env, platform = process.platform, spawnFn = spawn }) {
  const options = { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] };
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    const commandLine = [executable, ...args].map(quoteForCmd).join(' ');
    return spawnFn(env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], {
      ...options,
      windowsVerbatimArguments: true,
    });
  }
  return spawnFn(executable, args, options);
}

function killTree(child, platform = process.platform) {
  if (!child || child.exitCode != null) return;
  if (platform === 'win32' && child.pid) {
    // child.kill() would stop cmd.exe but leave the CLI it started running.
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      }).on('error', () => {});
    } catch {
      child.kill();
    }
  } else {
    child.kill('SIGTERM');
  }
}

/**
 * Run the CLI once, feeding `input` on stdin.
 * @returns {Promise<{exitCode: number|null, stdout: string, stderr: string, timedOut: boolean}>}
 */
function runProcess({
  executable,
  args,
  cwd,
  env,
  input = '',
  timeoutMs,
  onStdoutLine,
  platform = process.platform,
  spawnFn = spawn,
}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnClaude(executable, args, { cwd, env, platform, spawnFn });
    } catch (error) {
      reject(new ClaudeCliError(`Could not start Claude Code: ${error.message}`));
      return;
    }

    let stdout = '';
    let stderr = '';
    let pending = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child, platform);
    }, timeoutMs);

    const finish = fn => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!onStdoutLine) return;
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (line.trim()) onStdoutLine(line);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      if (stderr.length < STDERR_LIMIT) stderr += chunk;
    });

    child.on('error', error => {
      finish(() => reject(new ClaudeCliError(`Could not start Claude Code: ${error.message}`)));
    });

    child.on('close', exitCode => {
      if (onStdoutLine && pending.trim()) onStdoutLine(pending);
      finish(() => resolve({ exitCode, stdout, stderr, timedOut }));
    });

    // The CLI exits early on bad flags; ignore the resulting broken-pipe error.
    child.stdin.on('error', () => {});
    child.stdin.end(input, 'utf8');
  });
}

/**
 * Decide whether `claude auth status` output means calls will bill a Claude
 * subscription. API-key and third-party-cloud logins are rejected: routing them
 * through the CLI would cost the same as the API, only slower.
 */
function interpretAuthStatus(status) {
  if (!status || typeof status !== 'object') {
    return { usable: false, reason: 'could not read Claude Code login status' };
  }
  if (status.loggedIn !== true) {
    return { usable: false, reason: 'Claude Code is not logged in' };
  }
  if (status.apiProvider && status.apiProvider !== 'firstParty') {
    return {
      usable: false,
      reason: `Claude Code uses ${status.apiProvider}, not a Claude subscription`,
    };
  }
  if (/api.?key/i.test(String(status.authMethod || ''))) {
    return {
      usable: false,
      reason: 'Claude Code is logged in with an API key, not a subscription',
    };
  }
  return { usable: true, reason: 'logged in', authMethod: status.authMethod || null };
}

/** Pull the first JSON object out of stdout (tolerates log lines around it). */
function parseJsonObject(stdout) {
  const trimmed = (stdout || '').trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to a line-by-line scan
  }
  for (const line of trimmed.split('\n')) {
    const candidate = line.trim();
    if (!candidate.startsWith('{')) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // keep scanning
    }
  }
  return null;
}

/**
 * Check that the CLI runs and is logged in to a subscription.
 * @returns {Promise<{usable: boolean, reason: string, authMethod?: string|null, version?: string|null}>}
 */
async function probeClaudeCli({
  executable,
  env = buildChildEnv(),
  timeoutMs = PROBE_TIMEOUT_MS,
  platform = process.platform,
  spawnFn = spawn,
} = {}) {
  let run;
  try {
    run = await runProcess({
      executable,
      args: ['auth', 'status', '--json'],
      cwd: os.tmpdir(),
      env,
      timeoutMs,
      platform,
      spawnFn,
    });
  } catch (error) {
    return { usable: false, reason: error.message };
  }
  if (run.timedOut) return { usable: false, reason: 'Claude Code login check timed out' };
  // Logged-out status may exit non-zero, so read stdout whatever the exit code.
  return interpretAuthStatus(parseJsonObject(run.stdout));
}

/**
 * Split a completion request into the CLI's system prompt and stdin message.
 * With a transcript, the system prompt holds ONLY static text plus the
 * transcript, so it is byte-identical across every call for a meeting.
 */
function buildCliPrompts({ systemPrompt = '', userPrompt = '', cacheableContext } = {}) {
  let system;
  let user;
  if (cacheableContext) {
    system = `${TRANSCRIPT_SYSTEM_PREAMBLE}\n\nHere is the meeting transcript:\n\n${cacheableContext}`;
    user = systemPrompt
      ? `<instructions>\n${systemPrompt}\n</instructions>\n\n${userPrompt}`
      : userPrompt;
  } else {
    system = systemPrompt || DEFAULT_SYSTEM_PROMPT;
    user = userPrompt;
  }
  // The CLI exits with an error on empty input.
  if (!user || !user.trim()) user = 'Proceed with the task described above.';
  return { system, user };
}

/** Model names reach a cmd.exe command line, so allow only plain model-id characters. */
function assertSafeModel(model) {
  if (!/^[A-Za-z0-9._:[\]-]+$/.test(String(model || ''))) {
    throw new ClaudeCliError(`Refusing to pass unexpected model name to Claude Code: ${model}`);
  }
}

function buildCliArgs({ model, systemPromptFile, stream }) {
  assertSafeModel(model);
  const args = [...BASE_ARGS, '--model', model, '--system-prompt-file', systemPromptFile];
  if (stream) {
    args.push('--output-format', 'stream-json', '--verbose', '--include-partial-messages');
  } else {
    args.push('--output-format', 'json');
  }
  return args;
}

/** Turn the CLI's final `result` event into {content, model, usage}, or throw. */
function parseResultEvent(event, requestedModel) {
  if (!event || event.type !== 'result') {
    throw new ClaudeCliError('Claude Code returned no result');
  }
  const text = typeof event.result === 'string' ? event.result : '';
  if (event.is_error || event.subtype !== 'success') {
    const detail = text || (Array.isArray(event.errors) ? event.errors.join('; ') : '');
    // API errors come back as subtype 'success' with is_error set.
    const kind = event.subtype && event.subtype !== 'success' ? event.subtype : 'error';
    throw new ClaudeCliError(
      `Claude Code call failed (${kind}${
        event.api_error_status ? `, HTTP ${event.api_error_status}` : ''
      })${detail ? `: ${detail.slice(0, 300)}` : ''}`,
      { apiErrorStatus: event.api_error_status || null }
    );
  }
  if (!text.trim()) {
    throw new ClaudeCliError('Claude Code returned an empty response');
  }
  if (text.length < 300 && LIMIT_RESULT_PATTERNS.some(re => re.test(text.trim()))) {
    throw new ClaudeCliError(`Claude subscription limit reached: ${text.trim()}`);
  }
  const usedModels = Object.keys(event.modelUsage || {});
  return {
    content: text,
    model: usedModels[0] || requestedModel,
    usage: event.usage || null,
  };
}

function logCacheUsage(usage) {
  if (!usage) return;
  const cacheCreated = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const totalInput = cacheCreated + cacheRead + (usage.input_tokens || 0);
  if (cacheRead > 0) {
    const hitRate = totalInput > 0 ? ((cacheRead / totalInput) * 100).toFixed(1) : 0;
    console.log(
      `[Claude CLI] CACHE HIT: ${cacheRead}/${totalInput} tokens from cache (${hitRate}% hit rate)`
    );
  } else if (cacheCreated > 0) {
    console.log(`[Claude CLI] Cache created: ${cacheCreated} tokens (next calls will hit cache)`);
  } else {
    console.log('[Claude CLI] No cache activity - standard processing');
  }
}

/**
 * One completion through `claude -p`.
 * @param {Object} opts
 * @param {string} opts.executable - Path from resolveClaudeExecutable()
 * @param {string} opts.model - e.g. 'claude-sonnet-5-5'
 * @param {Function} [opts.onText] - Streams cumulative text when given
 * @returns {Promise<{content: string, model: string, usage: Object|null}>}
 */
async function runClaudeCli({
  executable,
  model,
  systemPrompt,
  userPrompt,
  cacheableContext,
  onText,
  workDir = DEFAULT_WORK_DIR,
  timeoutMs = DEFAULT_CALL_TIMEOUT_MS,
  env = buildChildEnv(),
  platform = process.platform,
  spawnFn = spawn,
}) {
  const { system, user } = buildCliPrompts({ systemPrompt, userPrompt, cacheableContext });

  // The system prompt goes through a file: a transcript is far too long for a
  // Windows command line. It's passed by relative name with cwd = workDir, so
  // no user-profile path ever lands on the command line.
  fs.mkdirSync(workDir, { recursive: true });
  const systemPromptFile = `system-${crypto.randomBytes(8).toString('hex')}.md`;
  const systemPromptPath = path.join(workDir, systemPromptFile);
  fs.writeFileSync(systemPromptPath, system, 'utf8');

  const stream = typeof onText === 'function';
  let streamedText = '';
  let resultEvent = null;

  const onStdoutLine = line => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === 'result') {
      resultEvent = event;
    } else if (
      stream &&
      event.type === 'stream_event' &&
      event.event?.type === 'content_block_delta' &&
      event.event.delta?.type === 'text_delta'
    ) {
      streamedText += event.event.delta.text || '';
      onText(streamedText);
    }
  };

  let run;
  try {
    run = await runProcess({
      executable,
      args: buildCliArgs({ model, systemPromptFile, stream }),
      cwd: workDir,
      env,
      input: user,
      timeoutMs,
      onStdoutLine: stream ? onStdoutLine : undefined,
      platform,
      spawnFn,
    });
  } finally {
    fs.rm(systemPromptPath, { force: true }, () => {});
  }

  if (run.timedOut) {
    throw new ClaudeCliError(`Claude Code timed out after ${Math.round(timeoutMs / 1000)}s`);
  }
  if (!stream) resultEvent = parseJsonObject(run.stdout);
  if (!resultEvent || resultEvent.type !== 'result') {
    const detail = (run.stderr || run.stdout || '').trim().slice(-500);
    throw new ClaudeCliError(
      `Claude Code exited with code ${run.exitCode} and no result${detail ? `: ${detail}` : ''}`,
      { exitCode: run.exitCode, stderr: run.stderr }
    );
  }

  const parsed = parseResultEvent(resultEvent, model);
  logCacheUsage(parsed.usage);
  return parsed;
}

/**
 * Tracks whether the CLI can be used right now: enabled in settings, installed,
 * logged in to a subscription, and not cooling down after a failed call.
 * Probe results are cached so a summary with many sections checks once.
 */
class ClaudeCliAvailability {
  constructor({
    enabled = true,
    resolveExecutable = resolveClaudeExecutable,
    probe = probeClaudeCli,
    now = Date.now,
  } = {}) {
    this.enabled = enabled;
    this._resolveExecutable = resolveExecutable;
    this._probe = probe;
    this._now = now;
    this._cached = null;
    this._inFlight = null;
    this._cooldownUntil = 0;
    this._lastError = null;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    this._cached = null;
    this._cooldownUntil = 0;
  }

  /**
   * @param {{force?: boolean}} [opts] - force: re-probe and clear any cooldown
   * @returns {Promise<{usable: boolean, reason: string, executable: string|null, authMethod: string|null}>}
   */
  async check({ force = false } = {}) {
    if (!this.enabled) {
      return {
        usable: false,
        reason: 'turned off in Settings',
        executable: null,
        authMethod: null,
      };
    }
    if (force) {
      this._cached = null;
      this._cooldownUntil = 0;
    }
    if (this._now() < this._cooldownUntil) {
      return {
        usable: false,
        reason: `paused after an error: ${this._lastError}`,
        executable: this._cached?.executable || null,
        authMethod: this._cached?.authMethod || null,
      };
    }
    if (this._cached) {
      const ttl = this._cached.usable ? AVAILABLE_TTL_MS : UNAVAILABLE_TTL_MS;
      if (this._now() - this._cached.checkedAt < ttl) return this._cached;
    }
    if (!this._inFlight) {
      this._inFlight = this._runProbe().finally(() => {
        this._inFlight = null;
      });
    }
    return this._inFlight;
  }

  async _runProbe() {
    const executable = this._resolveExecutable();
    let result;
    if (!executable) {
      result = { usable: false, reason: 'Claude Code is not installed', authMethod: null };
    } else {
      try {
        result = await this._probe({ executable });
      } catch (error) {
        result = { usable: false, reason: error.message };
      }
    }
    this._cached = {
      usable: !!result.usable,
      reason: result.reason,
      executable,
      authMethod: result.authMethod || null,
      checkedAt: this._now(),
    };
    console.log(
      `[Claude CLI] ${this._cached.usable ? 'Available' : 'Unavailable'}: ${this._cached.reason}${
        executable ? ` (${executable})` : ''
      }`
    );
    return this._cached;
  }

  recordSuccess() {
    this._cooldownUntil = 0;
    this._lastError = null;
  }

  recordFailure(error) {
    this._lastError = error?.message || String(error);
    this._cooldownUntil = this._now() + FAILURE_COOLDOWN_MS;
  }

  /** Last known state without probing (for the settings UI). */
  getSnapshot() {
    return {
      enabled: this.enabled,
      usable: this.enabled && !!this._cached?.usable && this._now() >= this._cooldownUntil,
      reason: this._cached?.reason || null,
      executable: this._cached?.executable || null,
      authMethod: this._cached?.authMethod || null,
      checkedAt: this._cached?.checkedAt || null,
      cooldownUntil: this._now() < this._cooldownUntil ? this._cooldownUntil : null,
      lastError: this._lastError,
    };
  }
}

module.exports = {
  ClaudeCliAvailability,
  ClaudeCliError,
  runClaudeCli,
  probeClaudeCli,
  resolveClaudeExecutable,
  interpretAuthStatus,
  buildCliPrompts,
  buildCliArgs,
  buildChildEnv,
  parseResultEvent,
  quoteForCmd,
  spawnClaude,
  DEFAULT_WORK_DIR,
  FAILURE_COOLDOWN_MS,
  AVAILABLE_TTL_MS,
  UNAVAILABLE_TTL_MS,
};
