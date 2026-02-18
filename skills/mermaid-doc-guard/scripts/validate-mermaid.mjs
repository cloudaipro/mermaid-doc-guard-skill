#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const TARGET = process.argv[2] ?? 'docs';
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);
const IGNORE_DIRS = new Set(['.git', '.svn', '.hg', 'node_modules']);
const MERMAID_BLOCK_PATTERN = /```mermaid\s*\n([\s\S]*?)```/g;

async function collectMarkdownFiles(inputPath) {
  const resolved = path.resolve(ROOT, inputPath);
  const stat = await fs.stat(resolved);

  if (stat.isFile()) {
    return MARKDOWN_EXTENSIONS.has(path.extname(resolved).toLowerCase()) ? [resolved] : [];
  }

  const results = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && IGNORE_DIRS.has(entry.name)) {
        continue;
      }

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }

  await walk(resolved);
  return results;
}

function extractMermaidBlocks(markdownText) {
  const blocks = [];
  let match;
  while ((match = MERMAID_BLOCK_PATTERN.exec(markdownText)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

function resolveMermaidCli() {
  const localMmdc = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'mmdc.cmd' : 'mmdc');
  if (existsSync(localMmdc)) {
    return { command: localMmdc, argsPrefix: [] };
  }

  return {
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    argsPrefix: ['-y', '@mermaid-js/mermaid-cli'],
  };
}

async function main() {
  const files = await collectMarkdownFiles(TARGET);
  const diagrams = [];

  for (const file of files) {
    const text = await fs.readFile(file, 'utf8');
    const blocks = extractMermaidBlocks(text);
    blocks.forEach((block, index) => {
      diagrams.push({
        file,
        index: index + 1,
        source: block.trim(),
      });
    });
  }

  if (diagrams.length === 0) {
    console.log(`No Mermaid blocks found under: ${TARGET}`);
    return;
  }

  const { command, argsPrefix } = resolveMermaidCli();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'law-mermaid-'));

  const failures = [];
  try {
    for (const diagram of diagrams) {
      const safeName = path.basename(diagram.file).replace(/[^a-zA-Z0-9._-]/g, '_');
      const inputFile = path.join(tempDir, `${safeName}-${diagram.index}.mmd`);
      const outputFile = path.join(tempDir, `${safeName}-${diagram.index}.svg`);

      await fs.writeFile(inputFile, `${diagram.source}\n`, 'utf8');

      const result = spawnSync(command, [...argsPrefix, '-i', inputFile, '-o', outputFile], {
        encoding: 'utf8',
      });

      if (result.status !== 0) {
        failures.push({
          ...diagram,
          stderr: (result.stderr ?? '').trim(),
          stdout: (result.stdout ?? '').trim(),
        });
      }
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`Mermaid validation failed for ${failures.length} diagram(s):`);
    failures.forEach((failure) => {
      const relativePath = path.relative(ROOT, failure.file) || failure.file;
      console.error(`\n- ${relativePath} (diagram #${failure.index})`);
      if (failure.stderr) {
        console.error(failure.stderr);
      } else if (failure.stdout) {
        console.error(failure.stdout);
      } else {
        console.error('Unknown Mermaid parser error.');
      }
    });
    process.exitCode = 1;
    return;
  }

  console.log(`Mermaid validation passed: ${diagrams.length} diagram(s) checked under ${TARGET}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
