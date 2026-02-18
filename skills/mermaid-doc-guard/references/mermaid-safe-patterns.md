# Mermaid Safe Patterns

## Node labels
- Prefer `node_id["Text"]` over bare `node_id[Text]` when text has punctuation.
- Use explicit IDs to avoid accidental parser token collisions.

## Line breaks
- Prefer `<br/>` in labels:
  - `service["API<br/>apps/api"]`
- Avoid relying on raw escape behavior where renderers differ.

## Characters to quote
If a label contains any of these, quote it:
- `@` `/` `:` `#` `{` `}` `[` `]` `<` `>` `|`

## Validation command
```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
node "$CODEX_HOME/skills/mermaid-doc-guard/scripts/validate-mermaid.mjs" docs
```

## Single-file validation
```bash
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
node "$CODEX_HOME/skills/mermaid-doc-guard/scripts/validate-mermaid.mjs" docs/technical/SYSTEM_ARCHITECTURE.md
```
