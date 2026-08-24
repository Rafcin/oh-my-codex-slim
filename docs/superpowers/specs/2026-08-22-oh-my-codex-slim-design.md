# Oh My Codex Slim Design Specification

> **Transport decision superseded on 2026-08-24.** OpenCodex is now the supported external-model transport. Codex Router and OpenCodex-to-Router cutover sections below are retained as historical design and exact attribution for legacy rollback compatibility; they do not describe the current product transport or authorize a new cutover. Current behavior is documented in [`docs/opencodex.md`](../../opencodex.md).

**Status:** Approved architecture, ready for implementation planning  
**Date:** 2026-08-22  
**Product:** `oh-my-codex-slim`  
**CLI:** `omcs`  
**Plugin identifier:** `oh-my-codex-slim`

## 1. Product intent

Oh My Codex Slim is a native workflow and orchestration layer for the Codex
desktop app and Codex CLI. It keeps Codex as the execution engine, uses native
Codex skills, plugins, hooks, MCP servers, and custom agents, and integrates
Codex Router as the sole external-model transport.

The product should feel like the best parts of Oh My Codex and Oh My OpenCode
Slim while remaining smaller, safer, easier to inspect, and fully usable in the
Codex desktop app without tmux.

## 2. Sources and provenance

The initial implementation may adapt MIT-licensed material from these pinned
upstream revisions:

| Source | Revision | Permitted use |
| --- | --- | --- |
| `Yeachan-Heo/oh-my-codex` | `3ad79a8a6fe6e95fdbb8c00e40716fffe4011ce2` | CLI, plugin, hook, state, installer, doctor, and test infrastructure |
| `alvinunreal/oh-my-opencode-slim` | `4940f73515d2969c50536fa1ec30a9ef5ee86741` | Lean role concepts, AST search, codemap, worktree, clone-dependency, and verification patterns |
| `mattpocock/skills` | `5b15a47f2d7150f545fbcacbfe381787fc0230dc` | Selected engineering workflow skills |
| `DannyMac180/sol-advisor` | `37b75cad535abdd46531f0227483a8842d045ab8` | Risk classification, selective routing, role packets, and fresh-review contract |
| `duolahypercho/codex-router` | `866cb8b011fa8e16900c77c58249b71eec6436ca` | Router integration contract, capability discovery, installer handoff, and model picker expectations |

The repository must include `LICENSE` and `THIRD_PARTY_NOTICES.md`. Adapted
files must retain required notices. Oh My OpenAgent is a behavioral research
source only; its Sustainable Use licensed implementation must not be copied.

## 3. Product boundaries

### Included in version 1

- A universal Codex plugin usable from the desktop app and CLI.
- An `omcs` management CLI.
- Native Codex custom-agent definitions.
- Sol Advisor-derived risk-gated orchestration.
- A curated, small skill catalog.
- A local MCP server for code intelligence tools.
- First-class Codex Router install, status, capability, doctor, and migration
  integration.
- Safe setup, update, uninstall, and rollback behavior.
- Exact local validation plus one opt-in, quota-consuming runtime smoke test.

### Explicitly excluded from version 1

- OpenCode runtime or OpenCode plugin dependencies.
- LazyCodex.
- tmux, zellij, terminal HUD, pane management, or detached-session ownership.
- OpenClaw, Hermes, GEO benchmarks, VS Code extensions, and unrelated adapters.
- Telemetry or analytics.
- A second credential store for model providers.
- Automatic promotion of an external model to native subagent status.
- Windows-specific runtime support. Windows may be documented as unsupported
  until a later release proves parity.

## 4. Runtime architecture

The product has five layers:

1. **Codex plugin:** distributes skills, hooks, MCP definitions, and App/CLI
   discovery metadata.
2. **Management CLI:** installs, updates, validates, and removes managed
   artifacts without replacing unrelated user configuration.
3. **Orchestration policy:** classifies risk and selects native Codex agents.
4. **Code-intelligence MCP:** exposes deterministic repository inspection tools.
5. **Router adapter:** queries and manages Codex Router without handling provider
   secrets itself.

Runtime state lives under `.omcs/` inside a project. User-scoped installation
metadata lives under `${CODEX_HOME:-~/.codex}/oh-my-codex-slim/`. Managed native
agent filenames begin with `omcs-`; setup and uninstall may modify only files
owned by that prefix or exact manifest records written by OMCS.

## 5. Plugin and CLI contract

The plugin root is `plugins/oh-my-codex-slim/` and contains:

- `.codex-plugin/plugin.json`
- `skills/`
- `hooks/hooks.json`
- `hooks/omcs-hook.mjs`
- `.mcp.json`
- `.app.json`

The CLI exposes:

```text
omcs setup [--scope user|project] [--dry-run]
omcs update [--dry-run]
omcs doctor [--json]
omcs status [--json]
omcs agents install|check|list
omcs router install|status|doctor|update|panel|capabilities
omcs migrate opencodex [--dry-run]
omcs uninstall [--dry-run]
```

All mutating commands must support a preview or exact change summary. Setup,
update, migration, and uninstall must fail closed on unknown ownership or
ambiguous configuration.

## 6. Agent model

OMCS installs the following native agents:

| Agent | Default model | Effort | Permission posture | Purpose |
| --- | --- | --- | --- | --- |
| `omcs_architect` | `gpt-5.6-sol` | `high` | inherited | Primary architect and route owner |
| `omcs_explorer` | `gpt-5.6-luna` | `low` | read-only | Fast repository mapping |
| `omcs_librarian` | `gpt-5.6-luna` | `medium` | read-only | Primary-source documentation research |
| `omcs_oracle` | `gpt-5.6-sol` | `high` | read-only | Difficult diagnosis and architecture advice |
| `omcs_fixer` | `gpt-5.6-luna` | `max` | inherited | Routine bounded implementation |
| `omcs_terra_fixer` | `gpt-5.6-terra` | `high` | inherited | Judgment-heavy or higher-risk implementation |
| `omcs_designer` | `gpt-5.6-terra` | `high` | inherited | UI/UX implementation and visual review |
| `omcs_reviewer` | `gpt-5.6-sol` | `high` | read-only | Fresh final review |

Router-generated external agent definitions remain owned by Codex Router. OMCS
discovers them through `codex-router control subagents status` and references
only models Router marks enabled and proven. OMCS never writes or rewrites
`router-model-*.toml` files.

## 7. Routing policy

Every substantial request receives one declared route:

- `solo`: architect works directly. Default for small or tightly coupled work.
- `delegate`: one selected implementer owns a settled, bounded change.
- `audit`: architect implements, verifies, then requests a fresh reviewer.
- `full`: one selected implementer owns production, the architect verifies, and
  a fresh reviewer produces `ship`, `fix-first`, or `rethink`.
- `council`: read-only synthesis across two or more genuinely different proven
  models. It is opt-in and never an implementation lane.

Luna is the routine implementation default. Terra is used when the task is
judgment-heavy, context-heavy, high-risk, or has a wider blast radius. A fresh
Sol reviewer never edits its own findings. Any fix invalidates the previous
review and requires fresh verification and review.

Each delegated packet contains exactly: objective, ownership, context,
constraints, and evidence required.

## 8. Skill catalog

Version 1 ships no more than twelve primary skills:

1. `omcs-orchestrate`
2. `deep-interview`
3. `plan`
4. `deepwork`
5. `tdd`
6. `diagnose`
7. `research`
8. `code-review`
9. `verification`
10. `simplify`
11. `ai-slop-cleaner`
12. `codemap`

Worktree and clone-dependency behavior are references/scripts used by the
relevant skills rather than additional always-visible skills. Skill descriptions
must be narrow enough for reliable automatic selection. Only two to five skills
should normally be active for one task.

## 9. Code-intelligence tools

The `omcs_code_intel` MCP server provides:

```text
omcs_ast_search
omcs_ast_replace
omcs_symbols
omcs_references
omcs_diagnostics
omcs_codemap
omcs_clone_dependency
```

AST operations use a pinned `@ast-grep/cli`. Language-server operations use
installed project language servers and return a clear unavailable result when
none is configured. `omcs_clone_dependency` clones into
`.omcs/clonedeps/repos/`, records URL and revision, and treats the clone as
read-only. The MCP server never downloads or executes an unknown language
server automatically.

Context7 and GitHub code search are optional external MCP integrations declared
disabled by default. They must not block plugin startup.

## 10. Codex Router integration

Codex Router remains a separately versioned MIT companion. OMCS manages it via
its supported CLI and never reads provider secrets.

`omcs router capabilities --json` returns a normalized document:

```json
{
  "installed": true,
  "healthy": true,
  "version": "0.4.0-beta.4",
  "subagentMode": "proven",
  "enabledAgents": [],
  "disabledAgents": []
}
```

The adapter obtains subagent state from
`codex-router control subagents status`, service health from
`codex-router status`, and installation health from
`codex-router doctor --json`. Unsupported or malformed output produces a typed
`incompatible-router` result rather than best-effort guessing.

The installer may offer the pinned Homebrew or upstream guided installation,
but must show the command before execution. `omcs router panel` launches the
official Router panel/Mac app. OMCS does not fork the Router UI.

## 11. OpenCodex migration

Migration is explicit and recoverable:

1. Detect current Codex config, OpenCodex service state, catalog path, and
   provider names without printing credentials.
2. Produce a dry-run report and backup manifest.
3. Use OpenCodex's supported restore/disable path so Codex no longer points at
   its proxy.
4. Install and enable Codex Router.
5. Transfer only an existing provider key through in-memory pipes into Router's
   supported credential command; never log or persist the value elsewhere.
6. Run Router doctor and OMCS doctor.
7. Preserve the OpenCodex data directory for rollback until the user explicitly
   requests removal.

Rollback restores the exact pre-migration Codex configuration and service state.

## 12. Safety and privacy

- No telemetry.
- No credential values in logs, JSON output, exceptions, tests, or support
  bundles.
- No recursive deletion outside exact managed directories.
- No overwrite of unknown agent, hook, skill, marketplace, or config entries.
- No quota-consuming smoke test without explicit confirmation.
- Read-only doctor and status commands are safe for unattended execution.
- All config writes are atomic and preserve an exact timestamped backup.

## 13. Verification and release gates

A release is acceptable only when all of these pass:

- Type checking and linting.
- Unit tests for routing, ownership, config merge, redaction, and parser failure.
- Plugin manifest and skill validation.
- Installer clean/idempotent/conflict/uninstall fixtures in an isolated
  `CODEX_HOME`.
- MCP protocol tests and path-traversal tests.
- Codex Router fixture tests for installed, missing, unhealthy, malformed, v1,
  and proven-v2 model states.
- Codex desktop plugin discovery proof in a new task.
- Codex CLI plugin discovery proof in a new session.
- Opt-in real model smoke test.
- Rollback proof restoring byte-identical pre-migration config.

## 14. Success criteria

A user can install one plugin and one CLI, work normally in the Codex desktop
app or CLI, receive disciplined specialist routing, use code-intelligence tools,
switch primary models through Codex Router, and safely enable proven external
subagents. Removing OMCS leaves unrelated Codex configuration and Router state
untouched.
