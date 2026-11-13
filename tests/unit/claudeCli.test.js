/**
 * Claude Code CLI bridge (src/main/services/claudeCli.js).
 *
 * Every process here is a fake: these tests never start the real `claude`
 * binary, so they spend no subscription usage and pass on machines without it.
 */
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');

const {
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
  FAILURE_COOLDOWN_MS,
  AVAILABLE_TTL_MS,
  UNAVAILABLE_TTL_MS,
} = require('../../src/main/services/claudeCli');

/**
 * Fake child process. respond(child, input, spawnArgs) runs once stdin closes
 * and drives stdout/stderr/close like the real CLI would.
 */
function makeSpawn(respond) {
  const calls = [];
  const spawnFn = (command, args, options) => {
    const child = new EventEmitter();
    child.pid = 4242;
    child.exitCode = null;
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = vi.fn(() => {
      child.exitCode = 143;
      child.emit('close', 143);
    });
    let input = '';
    child.stdin.on('data', chunk => (input += chunk));
    const call = { command, args, options, child };
    calls.push(call);
    child.stdin.on('end', () => {
      call.input = input;
      // Snapshot the system prompt file before runClaudeCli deletes it.
      const fileFlag = args.indexOf('--system-prompt-file');
      if (fileFlag !== -1) {
        call.systemPromptPath = path.join(options.cwd, args[fileFlag + 1]);
        call.systemPrompt = fs.readFileSync(call.systemPromptPath, 'utf8');
      }
      setImmediate(() => respond(child, input, call));
    });
    return child;
  };
  return { spawnFn, calls };
}

function finishWith(child, stdout, code = 0) {
  child.stdout.end(stdout);
  child.stderr.end();
  child.exitCode = code;
  setImmediate(() => child.emit('close', code));
}

const successResult = (text, extra = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: text,
  usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 33075 },
  modelUsage: { 'claude-sonnet-5-5': {} },
  ...extra,
});

let workDir;
beforeEach(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-cli-test-'));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('buildCliPrompts', () => {
  it('puts only static text and the transcript in the system prompt', () => {
    const a = buildCliPrompts({
      systemPrompt: 'Auto-summary format rules',
      userPrompt: 'Summarize.',
      cacheableContext: 'TRANSCRIPT BODY',
    });
    const b = buildCliPrompts({
      systemPrompt: 'Section analyst rules',
      userPrompt: 'Write the Action Items section.',
      cacheableContext: 'TRANSCRIPT BODY',
    });

    // Byte-identical system prompt across call types = prompt-cache hits.
    expect(a.system).toBe(b.system);
    expect(a.system).toContain('TRANSCRIPT BODY');
    expect(a.system).not.toContain('Auto-summary format rules');

    expect(a.user).toBe('<instructions>\nAuto-summary format rules\n</instructions>\n\nSummarize.');
  });

  it('uses the caller system prompt directly when there is no transcript', () => {
    expect(buildCliPrompts({ systemPrompt: 'Be terse.', userPrompt: 'Hi' })).toEqual({
      system: 'Be terse.',
      user: 'Hi',
    });
  });

  it('never sends empty stdin (the CLI rejects it)', () => {
    const { user } = buildCliPrompts({ systemPrompt: 'x', userPrompt: '  ' });
    expect(user.trim()).not.toBe('');
  });
});

describe('buildCliArgs', () => {
  it('isolates the call from tools, settings, MCP, skills and session files', () => {
    const args = buildCliArgs({ model: 'claude-sonnet-5-5', systemPromptFile: 'sys.md' });
    expect(args).toEqual(
      expect.arrayContaining([
        '-p',
        '--strict-mcp-config',
        '--disable-slash-commands',
        '--no-session-persistence',
      ])
    );
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('');
    expect(args[args.indexOf('--model') + 1]).toBe('claude-sonnet-5-5');
    expect(args[args.indexOf('--system-prompt-file') + 1]).toBe('sys.md');
    expect(args[args.indexOf('--output-format') + 1]).toBe('json');
  });

  it('switches to stream-json with partial messages for streaming', () => {
    const args = buildCliArgs({
      model: 'claude-haiku-5-5',
      systemPromptFile: 's.md',
      stream: true,
    });
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args).toEqual(expect.arrayContaining(['--verbose', '--include-partial-messages']));
  });

  it('rejects model names that could break a cmd.exe command line', () => {
    expect(() => buildCliArgs({ model: 'x" & calc', systemPromptFile: 's.md' })).toThrow(
      ClaudeCliError
    );
  });
});

describe('buildChildEnv', () => {
  it('strips API credentials and nested-session markers, case-insensitively', () => {
    const env = buildChildEnv({
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'sk-ant',
      anthropic_auth_token: 'tok',
      CLAUDECODE: '1',
      CLAUDE_CODE_USE_BEDROCK: '1',
      ANTHROPIC_BASE_URL: 'https://proxy.example',
    });
    expect(env).toEqual({ PATH: '/bin', ANTHROPIC_BASE_URL: 'https://proxy.example' });
  });
});

describe('interpretAuthStatus', () => {
  it('accepts a first-party subscription login', () => {
    expect(
      interpretAuthStatus({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' })
    ).toMatchObject({ usable: true, authMethod: 'claude.ai' });
  });

  it.each([
    [null, 'could not read'],
    [{ loggedIn: false }, 'not logged in'],
    [{ loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' }, 'API key'],
    [{ loggedIn: true, authMethod: 'oauth_token', apiProvider: 'bedrock' }, 'bedrock'],
  ])('rejects %j', (status, reason) => {
    const result = interpretAuthStatus(status);
    expect(result.usable).toBe(false);
    expect(result.reason).toContain(reason);
  });
});

describe('resolveClaudeExecutable', () => {
  const winEnv = {
    PATH: 'C:\\Windows;C:\\Users\\JD\\AppData\\Roaming\\npm',
    APPDATA: 'C:\\Users\\JD\\AppData\\Roaming',
  };

  it('prefers the native installer on Windows', () => {
    const files = new Set([
      'C:\\Users\\JD\\.local\\bin\\claude.exe',
      'C:\\Users\\JD\\AppData\\Roaming\\npm\\claude.cmd',
    ]);
    expect(
      resolveClaudeExecutable({
        env: winEnv,
        platform: 'win32',
        homeDir: 'C:\\Users\\JD',
        isFile: f => files.has(f),
      })
    ).toBe('C:\\Users\\JD\\.local\\bin\\claude.exe');
  });

  it('falls back to the npm shim on Windows', () => {
    const files = new Set(['C:\\Users\\JD\\AppData\\Roaming\\npm\\claude.cmd']);
    expect(
      resolveClaudeExecutable({
        env: { APPDATA: winEnv.APPDATA }, // GUI launch with no npm dir on PATH
        platform: 'win32',
        homeDir: 'C:\\Users\\JD',
        isFile: f => files.has(f),
      })
    ).toBe('C:\\Users\\JD\\AppData\\Roaming\\npm\\claude.cmd');
  });

  it('checks ~/.local/bin on macOS/Linux when PATH lacks it', () => {
    expect(
      resolveClaudeExecutable({
        env: { PATH: '/usr/bin' },
        platform: 'darwin',
        homeDir: '/Users/jd',
        isFile: f => f === '/Users/jd/.local/bin/claude',
      })
    ).toBe('/Users/jd/.local/bin/claude');
  });

  it('honours JD_NOTES_CLAUDE_PATH and returns null when nothing exists', () => {
    expect(
      resolveClaudeExecutable({
        env: { JD_NOTES_CLAUDE_PATH: '/opt/claude' },
        platform: 'linux',
        isFile: f => f === '/opt/claude',
      })
    ).toBe('/opt/claude');
    expect(
      resolveClaudeExecutable({ env: { PATH: '/usr/bin' }, platform: 'linux', isFile: () => false })
    ).toBeNull();
  });
});

describe('spawnClaude on Windows', () => {
  it('runs the npm .cmd shim through cmd.exe with empty args kept', () => {
    const spawnFn = vi.fn(() => ({}));
    spawnClaude(
      'C:\\Users\\J D\\AppData\\Roaming\\npm\\claude.cmd',
      ['-p', '--tools', '', '--model', 'claude-sonnet-5-5'],
      {
        cwd: 'C:\\tmp',
        env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' },
        platform: 'win32',
        spawnFn,
      }
    );
    const [command, args, options] = spawnFn.mock.calls[0];
    expect(command).toBe('C:\\Windows\\system32\\cmd.exe');
    expect(args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    expect(args[3]).toBe(
      '""C:\\Users\\J D\\AppData\\Roaming\\npm\\claude.cmd" -p --tools "" --model claude-sonnet-5-5"'
    );
    expect(options).toMatchObject({ windowsVerbatimArguments: true, windowsHide: true });
  });

  it('spawns a native .exe directly', () => {
    const spawnFn = vi.fn(() => ({}));
    spawnClaude('C:\\claude.exe', ['-p'], { cwd: 'C:\\tmp', env: {}, platform: 'win32', spawnFn });
    expect(spawnFn).toHaveBeenCalledWith('C:\\claude.exe', ['-p'], expect.any(Object));
  });

  it('quotes cmd.exe metacharacters', () => {
    expect(quoteForCmd('plain')).toBe('plain');
    expect(quoteForCmd('')).toBe('""');
    expect(quoteForCmd('a&b')).toBe('"a&b"');
  });
});

describe('parseResultEvent', () => {
  it('returns content, the model actually used, and usage', () => {
    expect(parseResultEvent(successResult('Summary'), 'claude-sonnet-5-5')).toMatchObject({
      content: 'Summary',
      model: 'claude-sonnet-5-5',
      usage: expect.objectContaining({ cache_read_input_tokens: 33075 }),
    });
  });

  it('throws on CLI-reported errors', () => {
    expect(() =>
      parseResultEvent(
        {
          type: 'result',
          subtype: 'success',
          is_error: true,
          result: 'Overloaded',
          api_error_status: 529,
        },
        'm'
      )
    ).toThrow(/\(error, HTTP 529\): Overloaded/);
    expect(() =>
      parseResultEvent({ type: 'result', subtype: 'error_during_execution', is_error: false }, 'm')
    ).toThrow(/error_during_execution/);
  });

  it('treats empty output and limit notices as failures (so the API takes over)', () => {
    expect(() => parseResultEvent(successResult('   '), 'm')).toThrow(/empty/);
    expect(() =>
      parseResultEvent(successResult('Claude AI usage limit reached|1794567600'), 'm')
    ).toThrow(/limit/);
    expect(() =>
      parseResultEvent(successResult("You've hit your limit · resets 3pm"), 'm')
    ).toThrow(/limit/);
  });
});

describe('runClaudeCli', () => {
  it('sends the transcript as a system prompt file and instructions on stdin', async () => {
    const { spawnFn, calls } = makeSpawn(child =>
      finishWith(child, JSON.stringify(successResult('## Summary\nDone')))
    );

    const result = await runClaudeCli({
      executable: '/usr/bin/claude',
      model: 'claude-sonnet-5-5',
      systemPrompt: 'Format rules',
      userPrompt: 'Summarize.',
      cacheableContext: 'Alice: hello',
      workDir,
      env: { PATH: '/usr/bin' },
      platform: 'linux',
      spawnFn,
    });

    expect(result).toMatchObject({ content: '## Summary\nDone', model: 'claude-sonnet-5-5' });
    const [call] = calls;
    expect(call.command).toBe('/usr/bin/claude');
    expect(call.options.cwd).toBe(workDir);
    expect(call.systemPrompt).toContain('Alice: hello');
    expect(call.input).toContain('<instructions>\nFormat rules\n</instructions>');
    // Passed by relative name, so no user-profile path lands on the command line.
    expect(call.args[call.args.indexOf('--system-prompt-file') + 1]).toMatch(
      /^system-[0-9a-f]+\.md$/
    );
  });

  it('deletes the system prompt file afterwards', async () => {
    const { spawnFn, calls } = makeSpawn(child =>
      finishWith(child, JSON.stringify(successResult('ok')))
    );
    await runClaudeCli({
      executable: 'claude',
      model: 'claude-haiku-5-5',
      userPrompt: 'hi',
      workDir,
      env: {},
      platform: 'linux',
      spawnFn,
    });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fs.existsSync(calls[0].systemPromptPath)).toBe(false);
  });

  it('streams cumulative text from stream-json deltas', async () => {
    const lines = [
      { type: 'system', subtype: 'init', apiKeySource: 'none' },
      { type: 'stream_event', event: { type: 'message_start' } },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
      },
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
      },
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } },
      successResult('Hello world'),
    ];
    const { spawnFn, calls } = makeSpawn(child => {
      // Split mid-line to exercise line buffering.
      const out = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
      child.stdout.write(out.slice(0, 50));
      child.stdout.write(out.slice(50));
      finishWith(child, '');
    });

    const chunks = [];
    const result = await runClaudeCli({
      executable: 'claude',
      model: 'claude-haiku-5-5',
      userPrompt: 'hi',
      onText: text => chunks.push(text),
      workDir,
      env: {},
      platform: 'linux',
      spawnFn,
    });

    expect(chunks).toEqual(['Hello ', 'Hello world']);
    expect(result.content).toBe('Hello world');
    expect(calls[0].args[calls[0].args.indexOf('--output-format') + 1]).toBe('stream-json');
  });

  it('reports stderr when the CLI exits without a result', async () => {
    const { spawnFn } = makeSpawn(child => {
      child.stderr.write('error: unknown option --setting-sources');
      finishWith(child, '', 1);
    });
    await expect(
      runClaudeCli({
        executable: 'claude',
        model: 'claude-haiku-5-5',
        userPrompt: 'hi',
        workDir,
        env: {},
        platform: 'linux',
        spawnFn,
      })
    ).rejects.toThrow(/code 1.*unknown option/);
  });

  it('kills a hung CLI after the timeout', async () => {
    const { spawnFn, calls } = makeSpawn(() => {}); // never answers
    await expect(
      runClaudeCli({
        executable: 'claude',
        model: 'claude-haiku-5-5',
        userPrompt: 'hi',
        workDir,
        env: {},
        platform: 'linux',
        spawnFn,
        timeoutMs: 30,
      })
    ).rejects.toThrow(/timed out/);
    expect(calls[0].child.kill).toHaveBeenCalled();
  });
});

describe('probeClaudeCli', () => {
  it('reads `claude auth status --json` even when it exits non-zero', async () => {
    const { spawnFn, calls } = makeSpawn(child =>
      finishWith(child, JSON.stringify({ loggedIn: false }), 1)
    );
    const result = await probeClaudeCli({
      executable: 'claude',
      env: {},
      platform: 'linux',
      spawnFn,
    });
    expect(calls[0].args).toEqual(['auth', 'status', '--json']);
    expect(result).toMatchObject({ usable: false, reason: 'Claude Code is not logged in' });
  });

  it('reports a missing binary instead of throwing', async () => {
    const spawnFn = () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      setImmediate(() => child.emit('error', new Error('spawn claude ENOENT')));
      return child;
    };
    const result = await probeClaudeCli({
      executable: 'claude',
      env: {},
      platform: 'linux',
      spawnFn,
    });
    expect(result.usable).toBe(false);
    expect(result.reason).toMatch(/ENOENT/);
  });
});

describe('ClaudeCliAvailability', () => {
  function makeAvailability(
    probeResult = { usable: true, reason: 'logged in', authMethod: 'claude.ai' }
  ) {
    let now = 1_000_000;
    const probe = vi.fn(async () => probeResult);
    const availability = new ClaudeCliAvailability({
      resolveExecutable: () => '/usr/bin/claude',
      probe,
      now: () => now,
    });
    return { availability, probe, advance: ms => (now += ms) };
  }

  it('probes once and shares the result (and concurrent checks)', async () => {
    const { availability, probe } = makeAvailability();
    const [a, b] = await Promise.all([availability.check(), availability.check()]);
    await availability.check();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a).toMatchObject({ usable: true, executable: '/usr/bin/claude' });
  });

  it('re-probes sooner when unavailable, so a fresh login is picked up', async () => {
    const { availability, probe, advance } = makeAvailability({
      usable: false,
      reason: 'not logged in',
    });
    await availability.check();
    advance(UNAVAILABLE_TTL_MS + 1);
    await availability.check();
    expect(probe).toHaveBeenCalledTimes(2);
    expect(UNAVAILABLE_TTL_MS).toBeLessThan(AVAILABLE_TTL_MS);
  });

  it('pauses after a failed call, then resumes', async () => {
    const { availability, advance } = makeAvailability();
    await availability.check();
    availability.recordFailure(new Error('HTTP 429'));

    const paused = await availability.check();
    expect(paused.usable).toBe(false);
    expect(paused.reason).toContain('HTTP 429');
    expect(availability.getSnapshot()).toMatchObject({ usable: false, lastError: 'HTTP 429' });

    advance(FAILURE_COOLDOWN_MS + 1);
    expect((await availability.check()).usable).toBe(true);
  });

  it('force-check clears the pause; disabling skips the probe entirely', async () => {
    const { availability, probe } = makeAvailability();
    availability.recordFailure(new Error('boom'));
    expect((await availability.check({ force: true })).usable).toBe(true);

    availability.setEnabled(false);
    const off = await availability.check();
    expect(off).toMatchObject({ usable: false, reason: 'turned off in Settings' });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('reports a missing install without probing', async () => {
    const probe = vi.fn();
    const availability = new ClaudeCliAvailability({ resolveExecutable: () => null, probe });
    expect(await availability.check()).toMatchObject({
      usable: false,
      reason: 'Claude Code is not installed',
    });
    expect(probe).not.toHaveBeenCalled();
  });
});
