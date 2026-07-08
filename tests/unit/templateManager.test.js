/**
 * TemplateManager Unit Tests
 *
 * Covers the v2.0 template write operations (create / save / delete) added to
 * complete the in-app template editor, plus the path-traversal guard.
 */

const { describe, it, expect, beforeEach, afterEach } = await import('vitest');

const fs = require('fs');
const os = require('os');
const path = require('path');
const TemplateManager = require('../../src/main/templates/TemplateManager');

let tmpDir;
let manager;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-test-'));
  manager = new TemplateManager(tmpDir);
  manager.scanTemplates();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('TemplateManager.createTemplate', () => {
  it('creates a Markdown template that parses and loads', () => {
    const created = manager.createTemplate({ name: 'Weekly Review', format: '.md' });

    expect(created).toBeTruthy();
    expect(created.id).toBe('weekly-review');
    expect(created.format).toBe('.md');
    expect(fs.existsSync(path.join(tmpDir, 'weekly-review.md'))).toBe(true);
    expect(manager.getTemplate('weekly-review')).toBeTruthy();
  });

  it('slugifies the name into a safe file id', () => {
    const created = manager.createTemplate({ name: '  Client   Call!! ', format: '.md' });
    expect(created.id).toBe('client-call');
  });

  it('scaffolds valid content for every supported format', () => {
    for (const format of ['.md', '.yaml', '.yml', '.json', '.txt']) {
      const created = manager.createTemplate({ name: `Sample ${format}`, format });
      // A non-null return means the scaffold parsed successfully on reload
      expect(created).toBeTruthy();
      expect(created.sections.length).toBeGreaterThan(0);
    }
  });

  it('uses provided content when given', () => {
    const content = `<!-- Template Metadata:
name: Custom
description: d
type: general
cost_estimate: 0.01
-->

## Only Section

<!-- Prompt: Do the thing. -->
`;
    const created = manager.createTemplate({ name: 'Custom One', format: '.md', content });
    expect(created.name).toBe('Custom');
  });

  it('rejects a duplicate file', () => {
    manager.createTemplate({ name: 'Dup', format: '.md' });
    expect(() => manager.createTemplate({ name: 'Dup', format: '.md' })).toThrow(/already exists/);
  });

  it('rejects an unsupported format', () => {
    expect(() => manager.createTemplate({ name: 'X', format: '.exe' })).toThrow(/Unsupported/);
  });

  it('rejects a name with no alphanumeric characters', () => {
    expect(() => manager.createTemplate({ name: '!!!', format: '.md' })).toThrow(/letters or numbers/);
  });

  it('rejects an empty name', () => {
    expect(() => manager.createTemplate({ name: '', format: '.md' })).toThrow(/name is required/);
  });
});

describe('TemplateManager.saveTemplate', () => {
  it('overwrites an existing template and reloads it', () => {
    manager.createTemplate({ name: 'Editable', format: '.md' });

    const newContent = `<!-- Template Metadata:
name: Renamed
description: updated
type: general
cost_estimate: 0.02
-->

## Section

<!-- Prompt: Updated prompt. -->
`;
    const saved = manager.saveTemplate('editable', newContent);
    expect(saved).toBeTruthy();
    expect(saved.name).toBe('Renamed');
    expect(fs.readFileSync(path.join(tmpDir, 'editable.md'), 'utf8')).toContain('Renamed');
  });

  it('throws when the template does not exist', () => {
    expect(() => manager.saveTemplate('missing', 'x')).toThrow(/not found/);
  });

  it('returns null when saved content no longer parses (file still written)', () => {
    manager.createTemplate({ name: 'Breakable', format: '.md' });
    // Missing metadata block → parse failure on reload
    const result = manager.saveTemplate('breakable', 'just some text with no metadata');
    expect(result).toBeNull();
    // File was still written to disk
    expect(fs.readFileSync(path.join(tmpDir, 'breakable.md'), 'utf8')).toBe(
      'just some text with no metadata'
    );
  });
});

describe('TemplateManager.deleteTemplate', () => {
  it('removes the file and unloads the template', () => {
    manager.createTemplate({ name: 'Trash Me', format: '.md' });
    expect(manager.getTemplate('trash-me')).toBeTruthy();

    const ok = manager.deleteTemplate('trash-me');
    expect(ok).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'trash-me.md'))).toBe(false);
    expect(manager.getTemplate('trash-me')).toBeNull();
  });

  it('throws when the template does not exist', () => {
    expect(() => manager.deleteTemplate('nope')).toThrow(/not found/);
  });
});

describe('TemplateManager path-traversal guard', () => {
  it('throws when a resolved path escapes the templates directory', () => {
    const outside = path.join(tmpDir, '..', 'escape.md');
    expect(() => manager._assertWithinTemplates(outside)).toThrow(/escapes/);
  });

  it('allows a path inside the templates directory', () => {
    const inside = path.join(tmpDir, 'ok.md');
    expect(() => manager._assertWithinTemplates(inside)).not.toThrow();
  });
});
