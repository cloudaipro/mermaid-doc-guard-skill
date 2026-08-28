#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const DEFAULT_TARGET = '.';
const DEFAULT_MERMAID_CLI_VERSION = '11.16.0';
const DEFAULT_TIMEOUT_MS = 30_000;
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const IGNORE_DIRS = new Set(['.git', '.svn', '.hg', 'node_modules']);

function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, '\n');
}

function parseOpeningFence(line) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})([^\n]*)$/);
  if (!match) return null;

  const fence = match[1];
  const info = match[2].trim();
  if (fence[0] === '`' && info.includes('`')) return null;

  const language = info.split(/[ \t]+/, 1)[0]?.toLowerCase() ?? '';
  return {
    char: fence[0],
    length: fence.length,
    info,
    language,
  };
}

function isClosingFence(line, opening) {
  const indentMatch = line.match(/^ {0,3}(.*)$/);
  if (!indentMatch) return false;

  const rest = indentMatch[1];
  const match = rest.match(/^(`+|~+)[ \t]*$/);
  if (!match) return false;

  const fence = match[1];
  return fence[0] === opening.char && fence.length >= opening.length;
}

export function scanMermaidBlocks(markdownText) {
  const lines = normalizeNewlines(markdownText).split('\n');
  const blocks = [];
  const errors = [];

  for (let i = 0; i < lines.length; i += 1) {
    const opening = parseOpeningFence(lines[i]);
    if (!opening) continue;

    const startLine = i + 1;
    let endIndex = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (isClosingFence(lines[j], opening)) {
        endIndex = j;
        break;
      }
    }

    if (endIndex === -1) {
      if (opening.language === 'mermaid') {
        errors.push({
          line: startLine,
          message: `Unclosed Mermaid code fence starting at line ${startLine}.`,
        });
      }
      break;
    }

    if (opening.language === 'mermaid') {
      blocks.push({
        source: lines.slice(i + 1, endIndex).join('\n').trim(),
        startLine,
        endLine: endIndex + 1,
      });
    }

    i = endIndex;
  }

  return { blocks, errors };
}

async function collectMarkdownFiles(inputPaths) {
  const results = new Set();

  async function addPath(inputPath) {
    const resolved = path.resolve(ROOT, inputPath);
    let stat;
    try {
      stat = await fs.stat(resolved);
    } catch (error) {
      throw new Error(`Target does not exist or cannot be read: ${inputPath}`);
    }

    if (stat.isFile()) {
      if (MARKDOWN_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
        results.add(resolved);
      }
      return;
    }

    if (!stat.isDirectory()) return;

    async function walk(dir) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }

        if (MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          results.add(fullPath);
        }
      }
    }

    await walk(resolved);
  }

  for (const inputPath of inputPaths) {
    await addPath(inputPath);
  }

  return [...results].sort();
}

function parseArgs(argv) {
  const targets = [];
  let mermaidCliVersion = process.env.MERMAID_CLI_VERSION || DEFAULT_MERMAID_CLI_VERSION;
  let timeoutMs = Number(process.env.MERMAID_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mermaid-cli-version') {
      const value = argv[++i];
      if (!value) throw new Error('--mermaid-cli-version requires a value.');
      mermaidCliVersion = value;
    } else if (arg === '--timeout-ms') {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error('--timeout-ms requires a positive number.');
      }
      timeoutMs = value;
    } else if (arg === '--help' || arg === '-h') {
      return { help: true, targets: [], mermaidCliVersion, timeoutMs };
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      targets.push(arg);
    }
  }

  return {
    help: false,
    targets: targets.length > 0 ? targets : [DEFAULT_TARGET],
    mermaidCliVersion,
    timeoutMs,
  };
}

function resolveMermaidCli(version) {
  const localMmdc = path.join(
    ROOT,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'mmdc.cmd' : 'mmdc',
  );
  if (existsSync(localMmdc)) {
    return {
      command: localMmdc,
      argsPrefix: [],
      label: 'local mmdc',
    };
  }

  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    argsPrefix: ['--yes', '--package', `@mermaid-js/mermaid-cli@${version}`, 'mmdc'],
    label: `@mermaid-js/mermaid-cli@${version}`,
  };
}

function runProcess(command, args, timeoutMs) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: timeoutMs,
  });

  return {
    status: result.status,
    signal: result.signal,
    error: result.error,
    stderr: (result.stderr ?? '').trim(),
    stdout: (result.stdout ?? '').trim(),
  };
}

function formatProcessFailure(result) {
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      return `Renderer timed out: ${result.error.message}`;
    }
    return `Failed to start renderer: ${result.error.message}`;
  }
  if (result.signal) return `Renderer terminated by signal ${result.signal}.`;
  return result.stderr || result.stdout || `Renderer exited with status ${result.status}.`;
}

export function rendererLooksUnavailable(result) {
  if (result.error || result.signal) return true;
  const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
  const environmentMarkers = [
    'could not find chrome',
    'failed to launch the browser process',
    'no usable sandbox',
    'cannot find module',
    'command not found',
    'is not recognized as an internal or external command',
    'npm err!',
    'npm error code',
    'econnrefused',
    'enotfound',
    'getaddrinfo',
    'fetch failed',
    'unable to verify the first certificate',
    'permission denied',
  ];
  return environmentMarkers.some((marker) => text.includes(marker));
}

async function smokeTestRenderer(renderer, tempDir, timeoutMs) {
  const inputFile = path.join(tempDir, '__smoke__.mmd');
  const outputFile = path.join(tempDir, '__smoke__.svg');
  await fs.writeFile(inputFile, 'flowchart LR\n  a["A"] --> b["B"]\n', 'utf8');
  return runProcess(renderer.command, [...renderer.argsPrefix, '-i', inputFile, '-o', outputFile], timeoutMs);
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 3;
    return;
  }

  if (options.help) {
    console.log('Usage: validate-mermaid.mjs [--mermaid-cli-version VERSION] [--timeout-ms MS] [path ...]');
    console.log('If no path is supplied, the current repository is scanned.');
    return;
  }

  let files;
  try {
    files = await collectMarkdownFiles(options.targets);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 3;
    return;
  }

  const diagrams = [];
  const markdownErrors = [];

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const { blocks, errors } = scanMermaidBlocks(text);

    blocks.forEach((block, index) => {
      diagrams.push({
        file,
        index: index + 1,
        source: block.source,
        startLine: block.startLine,
        endLine: block.endLine,
      });
    });

    errors.forEach((error) => markdownErrors.push({ file, ...error }));
  }

  if (markdownErrors.length > 0) {
    console.error(`Markdown fence validation failed for ${markdownErrors.length} Mermaid block(s):`);
    for (const failure of markdownErrors) {
      console.error(`- ${path.relative(ROOT, failure.file) || failure.file}:${failure.line} — ${failure.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (diagrams.length === 0) {
    console.log(`No Mermaid blocks found in ${files.length} Markdown file(s) across: ${options.targets.join(', ')}`);
    return;
  }

  const renderer = resolveMermaidCli(options.mermaidCliVersion);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mermaid-doc-guard-'));

  try {
    console.log(`Mermaid renderer: ${renderer.label}`);
    const smoke = await smokeTestRenderer(renderer, tempDir, options.timeoutMs);
    if (smoke.status !== 0) {
      console.error('Mermaid validator environment check failed. No diagrams were modified or judged invalid.');
      console.error(formatProcessFailure(smoke));
      process.exitCode = 2;
      return;
    }

    const failures = [];
    for (const diagram of diagrams) {
      const relativePath = path.relative(ROOT, diagram.file) || diagram.file;
      const safeName = relativePath.replace(/[^a-zA-Z0-9._-]/g, '_');
      const inputFile = path.join(tempDir, `${safeName}-${diagram.index}.mmd`);
      const outputFile = path.join(tempDir, `${safeName}-${diagram.index}.svg`);
      await fs.writeFile(inputFile, `${diagram.source}\n`, 'utf8');

      const result = runProcess(
        renderer.command,
        [...renderer.argsPrefix, '-i', inputFile, '-o', outputFile],
        options.timeoutMs,
      );

      if (result.status !== 0) {
        if (rendererLooksUnavailable(result)) {
          console.error(`Mermaid validator environment failed while checking ${relativePath}:${diagram.startLine}.`);
          console.error(formatProcessFailure(result));
          process.exitCode = 2;
          return;
        }
        failures.push({ ...diagram, result });
      }
    }

    if (failures.length > 0) {
      console.error(`Mermaid validation failed for ${failures.length} diagram(s):`);
      for (const failure of failures) {
        const relativePath = path.relative(ROOT, failure.file) || failure.file;
        console.error(`\n- ${relativePath}:${failure.startLine} (diagram #${failure.index})`);
        console.error(formatProcessFailure(failure.result));
      }
      process.exitCode = 1;
      return;
    }

    console.log(`Mermaid validation passed: ${diagrams.length} diagram(s) checked in ${files.length} Markdown file(s).`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 2;
  });
}
