# Oh My Codex Slim

Oh My Codex Slim (`omcs`) is a Codex-native workflow and orchestration layer for the Codex desktop app and Codex CLI. It installs eight native Codex agents, a deliberately small skill catalog, a bounded local code-intelligence MCP server, and ownership-safe lifecycle commands.

[OpenCodex](https://github.com/lidge-jun/opencodex) is the supported external-model transport. It remains separately installed and owns provider authentication, model routing, service state, and credential storage. OMCS does not install an OpenCode runtime, LazyCodex, tmux, telemetry, or a second credential store. It never runs a quota-consuming model smoke test without explicit approval for that specific test.

## Start here

Requires Node.js 22.19 or newer, Codex CLI, and OpenCodex when external-model routing is desired.

```bash
npm install -g oh-my-codex-slim
codex plugin marketplace add <repo> --json
codex plugin add oh-my-codex-slim@omcs-local --json
omcs setup --dry-run --json
omcs setup --json
omcs doctor --json
omcs status --json
```

The package contains the local `omcs-local` marketplace and the `oh-my-codex-slim` plugin. Codex CLI exclusively owns marketplace registration; `omcs setup` installs managed agents and a comment-only lifecycle marker and never writes a `[marketplaces.omcs-local]` table.

For external routing, configure and operate OpenCodex through its supported `ocx` interface:

```bash
ocx service status
ocx status
ocx health --json
```

These checks do not run a real model request. Provider login and credentials remain inside OpenCodex; never paste them into OMCS commands, logs, issues, or chat.

See [installation](docs/installation.md), [architecture](docs/architecture.md), [OpenCodex integration](docs/opencodex.md), and [troubleshooting](docs/troubleshooting.md).

## Safe lifecycle

```bash
omcs update --dry-run --json
omcs agents check --json
omcs uninstall --dry-run --json
```

Update is explicit-only and reuses setup ownership. Uninstall removes only the comment-only OMCS lifecycle block and digest-matching `agents/omcs-*.toml` files. It preserves Codex-owned marketplace registration, unrelated Codex configuration, user agents, OpenCodex data, and any pre-existing migration rollback evidence.

The repository retains attributed legacy Codex Router compatibility code only so a user with an earlier OMCS migration manifest can recover or inspect rollback state. Codex Router is not the supported active transport, and OMCS no longer exposes Router installation, update, panel, or OpenCodex-to-Router cutover as normal lifecycle operations.

## Privacy and verification

Local runtime state under `.omcs/`, `.gjc/`, and `.superpowers/sdd/` is ignored and must never be committed. `npm run verify:release` is an offline acceptance gate. A real model smoke is optional, billed, and requires separate explicit approval.

The public MCP surface exposes six code-intelligence tools. Its host binds operations to the launch-time project root, rejects oversized files and trees, and does not expose the legacy dependency-clone helper.

## Authors, owners, and licenses

OMCS is original integration work built on a pinned attributed MIT baseline and attributed behavior/interface research. Full revision, license, source-path, adaptation-status, author, contributor, and repository-owner metadata is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The notices name the published identities we rely on: Yeachan Heo (`Yeachan-Heo`), Alvin (`alvinunreal`), Matt Pocock (`mattpocock`), Daniel McAteer (`DannyMac180`), `opencodex contributors` and owner `lidge-jun`, Herrington Darkholme (`HerringtonDarkholme`) for ast-grep, `code-yeongyu` for the behavioral-only Oh My OpenAgent reference, and—only for retained legacy compatibility—`codex-router contributors`, commit author `Duola`, and owner `duolahypercho`. No fuller personal names are invented where upstream does not publish one.

Licensed under MIT; see [LICENSE](LICENSE).
