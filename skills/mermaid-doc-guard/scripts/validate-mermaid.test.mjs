import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { rendererLooksUnavailable, scanMermaidBlocks } from './validate-mermaid.mjs';

const SCRIPT_PATH = fileURLToPath(new URL('./validate-mermaid.mjs', import.meta.url));

test('extracts a standard backtick Mermaid fence', () => {
  const result = scanMermaidBlocks('before\n```mermaid\nflowchart LR\n  A --> B\n```\nafter\n');
  assert.equal(result.errors.length, 0);
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].startLine, 2);
  assert.equal(result.blocks[0].endLine, 5);
  assert.match(result.blocks[0].source, /A --> B/);
});

test('accepts whitespace before the mermaid info string', () => {
  const result = scanMermaidBlocks('``` mermaid\nflowchart LR\nA --> B\n```');
  assert.equal(result.blocks.length, 1);
});

test('accepts tilde fences', () => {
  const result = scanMermaidBlocks('~~~mermaid\nsequenceDiagram\nA->>B: Hi\n~~~');
  assert.equal(result.blocks.length, 1);
});

test('requires the closing fence to be at least as long as the opening fence', () => {
  const result = scanMermaidBlocks('````mermaid\nflowchart LR\nA --> B\n```');
  assert.equal(result.blocks.length, 0);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /Unclosed Mermaid code fence/);
});

test('accepts a longer matching closing fence', () => {
  const result = scanMermaidBlocks('```mermaid\nflowchart LR\nA --> B\n````');
  assert.equal(result.errors.length, 0);
  assert.equal(result.blocks.length, 1);
});

test('does not close a backtick fence with tildes', () => {
  const result = scanMermaidBlocks('```mermaid\nflowchart LR\nA --> B\n~~~');
  assert.equal(result.blocks.length, 0);
  assert.equal(result.errors.length, 1);
});

test('handles CRLF line endings', () => {
  const result = scanMermaidBlocks('```mermaid\r\nflowchart LR\r\nA --> B\r\n```\r\n');
  assert.equal(result.errors.length, 0);
  assert.equal(result.blocks.length, 1);
});

test('supports up to three spaces of indentation', () => {
  const result = scanMermaidBlocks('   ```mermaid\nflowchart LR\nA --> B\n   ```');
  assert.equal(result.blocks.length, 1);
});

test('ignores non-Mermaid fenced blocks', () => {
  const result = scanMermaidBlocks('```js\nconst x = 1;\n```\n');
  assert.equal(result.errors.length, 0);
  assert.equal(result.blocks.length, 0);
});

test('reports an unclosed Mermaid fence', () => {
  const result = scanMermaidBlocks('text\n```mermaid\nflowchart LR\nA --> B\n');
  assert.equal(result.blocks.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 2);
});

test('extracts multiple Mermaid diagrams and preserves line numbers', () => {
  const result = scanMermaidBlocks([
    '# Doc',
    '```mermaid',
    'flowchart LR',
    'A --> B',
    '```',
    'text',
    '~~~mermaid',
    'stateDiagram-v2',
    'A --> B',
    '~~~',
  ].join('\n'));
  assert.equal(result.blocks.length, 2);
  assert.deepEqual(result.blocks.map((block) => block.startLine), [2, 7]);
});

test('classifies process spawn failures as environment failures', () => {
  assert.equal(rendererLooksUnavailable({
    error: Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' }),
    signal: null,
    stderr: '',
    stdout: '',
  }), true);
});

test('classifies Chromium launch failures as environment failures', () => {
  assert.equal(rendererLooksUnavailable({
    error: null,
    signal: null,
    stderr: 'Error: Failed to launch the browser process!',
    stdout: '',
  }), true);
});

test('does not classify ordinary Mermaid parse errors as environment failures', () => {
  assert.equal(rendererLooksUnavailable({
    error: null,
    signal: null,
    stderr: 'Error: Parse error on line 2: unexpected token',
    stdout: '',
  }), false);
});

test('CLI returns exit 3 for a missing target', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, path.join(os.tmpdir(), 'definitely-missing-mermaid-doc.md')], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 3);
  assert.match(result.stderr, /Target does not exist or cannot be read/);
});

test('CLI returns exit 0 when a selected Markdown file has no Mermaid blocks', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mermaid-doc-guard-test-'));
  try {
    const input = path.join(tempDir, 'plain.md');
    fs.writeFileSync(input, '# Plain Markdown\nNo diagram here.\n');
    const result = spawnSync(process.execPath, [SCRIPT_PATH, input], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /No Mermaid blocks found/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('CLI returns exit 1 for an unclosed Mermaid fence without invoking the renderer', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mermaid-doc-guard-test-'));
  try {
    const input = path.join(tempDir, 'broken.md');
    fs.writeFileSync(input, '```mermaid\nflowchart LR\nA --> B\n');
    const result = spawnSync(process.execPath, [SCRIPT_PATH, input], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Markdown fence validation failed/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('CLI returns exit 3 for a missing Puppeteer config', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mermaid-doc-guard-test-'));
  try {
    const input = path.join(tempDir, 'plain.md');
    fs.writeFileSync(input, '# Plain Markdown\n');
    const result = spawnSync(process.execPath, [SCRIPT_PATH, '--puppeteer-config', path.join(tempDir, 'missing.json'), input], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 3);
    assert.match(result.stderr, /Puppeteer config does not exist/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
