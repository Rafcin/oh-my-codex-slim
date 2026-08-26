# Troubleshooting

Start with read-only, non-model output:

```bash
omcs doctor --json
omcs status --json
omcs agents check --json
ocx service status
ocx status
ocx health --json
```

Do not paste provider configuration, access tokens, caller URLs, or unredacted local paths into an issue.

## Doctor exits 1

Doctor validates Node, Codex, plugin discovery, the OMCS marker, managed agents, MCP startup, and the supported OpenCodex/native routing state. Active OpenCodex routing is supported and must not be reported as stale. Missing OpenCodex is not an OMCS failure when native Codex is intentional.

## Setup, update, or uninstall reports conflicts

Do not delete or overwrite the named file. OMCS refuses unknown `omcs-*` files, modified owned agents, symbolic links, hard links, unsafe homes, and ambiguous config ownership. Preserve the conflict and compare it with `${CODEX_HOME}/oh-my-codex-slim/managed-files.json`.

Uninstall keeps unrelated config/files, OpenCodex data, provider credentials, and legacy migration manifests/backups. Retain timestamped backups until the result is verified.

## OpenCodex is unavailable

Use `ocx service status`, `ocx status`, and `ocx health --json`. These checks do not invoke a real model. If setup or login is required, use OpenCodex's supported interactive flow and keep secrets inside OpenCodex. OMCS does not repair, copy, or ask for provider credentials.

Do not use a real provider prompt as a diagnostic without explicit approval for that quota-consuming test.

## Legacy migration rollback

If an earlier OMCS experiment migrated Codex away from OpenCodex, preserve the exact mode-`0600` migration manifest and backups. The rollback is intentionally explicit:

```bash
omcs migrate opencodex --rollback /absolute/path/to/opencodex-migration.json --json
```

New OpenCodex-to-Codex-Router cutovers are not supported. Never delete rollback evidence merely to make health output green.

## Plugin is not visible

The canonical selector is `oh-my-codex-slim@omcs-local`:

```bash
codex plugin marketplace add <repo> --json
codex plugin add oh-my-codex-slim@omcs-local --json
codex plugin list --json
```

Marketplace registration belongs to Codex CLI. `omcs setup` writes only a comment marker and must not add a second `[marketplaces.omcs-local]` table.

## OMCS asks for a configuration scope

Choose project scope when the repository needs portable, checked-in engineering policy; choose global scope for private defaults; choose session scope for a no-write trial. Project policy cannot contain credentials, provider configuration, account preferences, or model pins. Use these read-only checks if the result is unexpected:

```bash
omcs config show --effective --json
omcs config validate omcs.config.json --json
```

Do not force an unsafe replacement. `omcs configure` rejects links, unknown ownership, and invalid policy before it writes. See [configuration](configuration.md).

## A route needs escalation or a material decision

OMCS may raise its route when it discovers a broader interface, persistent contract, security boundary, dependency, or irreversible external action. It pauses only for material decisions that change user-visible scope, compatibility, data/configuration, security/privacy, architecture, dependencies, or costly external state. Routine implementation choices remain autonomous. See [execution modes](execution-modes.md).

## Attribution and support evidence

Include the OMCS version, redacted doctor/status output, and the exact non-secret failing path. The attribution ledger names Yeachan Heo, Alvin, Matt Pocock, Daniel McAteer, `opencodex contributors`/`lidge-jun`, Herrington Darkholme (`HerringtonDarkholme`), behavioral-reference owner `code-yeongyu`, and legacy compatibility authors/owners `codex-router contributors`, `Duola`, and `duolahypercho`. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md); do not invent fuller names.
