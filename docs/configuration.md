# OMCS configuration

Configuration is policy, not a credential store. A first OMCS run offers **project**, **global**, or **session** scope.

## Scopes and precedence

```text
session override
    ↓
nearest omcs.config.json
    ↓
global OMCS preferences
    ↓
built-in safe defaults
```

Project discovery walks from the working directory to the Git root, stops at that root, and does not follow symbolic links. The project file is checked-in portable team policy. Global preferences are private at `${CODEX_HOME}/oh-my-codex-slim/config.json`. Session scope resolves defaults in workflow context and writes nothing.

```bash
# Recommended: preview, then write portable project policy.
omcs configure --scope project --profile auto --dry-run --json
omcs configure --scope project --profile auto --json

# Private preference or a no-write one-off.
omcs configure --scope global --profile thorough --json
omcs configure --scope session --profile fast --json

# Inspect or validate without revealing unneeded configuration contents.
omcs config show --effective --json
omcs config validate omcs.config.json --json
```

## Checked-in policy

```json
{
  "$schema": "https://raw.githubusercontent.com/Rafcin/oh-my-codex-slim/main/schema/omcs.schema.json",
  "version": 1,
  "profile": "auto",
  "approval": "material-decisions",
  "quality": {
    "clarification": "adaptive",
    "design": "adaptive",
    "tdd": "adaptive",
    "review": "risk-gated",
    "antiSlop": "changed-files"
  },
  "orchestration": {
    "maxParallel": 2,
    "council": "explicit-only"
  }
}
```

Unknown fields are rejected. Version 1 never accepts provider configuration, accounts, tokens, secret values, URLs with credentials, model pins, or arbitrary command paths. Native role definitions own their supported model and effort contracts; OpenCodex owns any external-model selection.

## Ownership-safe writes

`omcs configure` preflights the target, rejects links and ambiguous ownership, writes atomically, and preserves unrelated files. A different existing `omcs.config.json` is not overwritten until `--update` is explicit and the file parses as valid version-1 OMCS policy. Dry runs show the proposed action without writing. Session scope always reports resolved defaults and never persists state.

See [execution modes](execution-modes.md) for profile behavior and [installation](installation.md) for lifecycle ownership.
