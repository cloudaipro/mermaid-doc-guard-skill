# Mermaid Doc Guard Skill

Reusable Codex skill for validating Mermaid diagrams in Markdown with a real Mermaid renderer and guiding minimal, syntax-safe repairs.

## What it guards against

- Mermaid parse/render failures.
- Markdown fence forms that a simple regex can miss, including tilde fences and whitespace before the `mermaid` info string.
- Incorrect closing-fence length/type.
- Accidental diagram rewrites caused by Node, npm/npx, mmdc, Puppeteer/Chromium, network, permission, timeout, or sandbox failures.
- Validation that silently ignores Markdown outside a hard-coded `docs/` directory.

## Install with Codex

Use the built-in `$skill-installer` and provide this GitHub skill URL:

```text
$skill-installer Install https://github.com/cloudaipro/mermaid-doc-guard-skill/tree/main/skills/mermaid-doc-guard
```

The installer accepts GitHub repository paths and installs the skill under `$CODEX_HOME/skills` (normally `~/.codex/skills`).

## Manual install

From a clone of this repository:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/mermaid-doc-guard "${CODEX_HOME:-$HOME/.codex}/skills/mermaid-doc-guard"
```

Restart Codex after a manual install if the skill is not picked up immediately.

## Validate directly

Validate one or more files/directories:

```bash
node skills/mermaid-doc-guard/scripts/validate-mermaid.mjs README.md skills/mermaid-doc-guard
```

Validate the entire current repository:

```bash
node skills/mermaid-doc-guard/scripts/validate-mermaid.mjs
```

Exit codes:

- `0` — diagrams passed, or no Mermaid blocks were found in scope.
- `1` — genuine Mermaid/fence validation failure.
- `2` — renderer/tooling/environment failure; do not repair diagram source based on this result.
- `3` — invalid arguments or target path.

The validator prefers a repository-local `node_modules/.bin/mmdc`. Otherwise it uses a pinned `@mermaid-js/mermaid-cli@11.16.0` fallback through `npx`. The default render timeout is 120 seconds so a first-time npx/Puppeteer setup has enough time to initialize; override it with `MERMAID_TIMEOUT_MS` or `--timeout-ms` when needed. Override the fallback renderer version with `MERMAID_CLI_VERSION` or `--mermaid-cli-version`.

## Tests

The parser, failure-classification, and CLI exit-code regression tests use Node's built-in test runner:

```bash
node --test skills/mermaid-doc-guard/scripts/validate-mermaid.test.mjs
```

## Skill path

- `skills/mermaid-doc-guard`
