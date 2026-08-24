# Installation and discovery

## Prerequisites

- macOS, Node.js 22.19 or newer, and Codex CLI.
- A safe, non-symlinked `${CODEX_HOME:-~/.codex}`.
- OpenCodex when external-model routing is desired.

OMCS has no tmux, OpenCode, LazyCodex, telemetry, provider-SDK, or Codex Router runtime dependency.

## Register discovery with Codex

The package ships `.agents/plugins/marketplace.json` with marketplace `omcs-local` and plugin `oh-my-codex-slim`. The canonical selector is `oh-my-codex-slim@omcs-local`. Codex CLI is the sole owner of `[marketplaces.omcs-local]` registration:

```bash
codex plugin marketplace add <repo> --json
codex plugin add oh-my-codex-slim@omcs-local --json
codex plugin list --json
```

## Install OMCS-owned files

Preview before applying:

```bash
omcs setup --scope user --dry-run --json
omcs setup --scope user --json
omcs doctor --json
```

Project scope writes only `.codex/config.toml` and `.codex/agents/omcs-*.toml` under that project. Existing unknown reserved files, symbolic links, hard links, or ownership drift fail closed. The config change is a non-semantic, comment-only lifecycle marker; it does not create or replace Codex marketplace registration.

## OpenCodex

Install and configure OpenCodex through its own supported distribution and interactive setup. OpenCodex—not OMCS—owns provider authentication and secrets.

```bash
ocx setup
ocx service status
ocx status
ocx health --json
```

`ocx setup` is interactive and may request provider authorization. The three status/health commands are the preferred non-model verification boundary. Do not run a provider/model request solely as a smoke test unless the user explicitly approves that billed test.

OMCS does not migrate OpenCodex away, import provider keys, or duplicate its provider configuration. If an earlier OMCS experiment created an OpenCodex-to-Codex-Router migration manifest, retain it as rollback evidence; the legacy rollback path remains recoverable but is not part of a new install.

## Update and uninstall

There is no automatic or launch-time OMCS update:

```bash
omcs update --dry-run --json
omcs update --json
omcs uninstall --dry-run --json
omcs uninstall --json
```

Uninstall removes only OMCS-owned markers and digest-matching agent files. Codex-owned marketplace registration, OpenCodex, provider credentials, legacy migration manifests/backups, and unrelated Codex files remain untouched.

See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for complete author and owner attribution.
