# OpenCodex integration

OpenCodex is the supported external-model transport for OMCS. It is a separately installed and licensed companion owned by the OpenCodex project. OMCS does not vendor it, start or stop it during OMCS lifecycle operations, or own its accounts, provider keys, model catalog, service configuration, or data directory.

OpenCodex is optional: OMCS works with native Codex when no external-model route is desired. If used, it is the sole supported external-model transport. OMCS does not recommend or install Codex Router, an OpenCode runtime, LazyCodex, a daemon, tmux, or telemetry as part of orchestration.

## Non-model verification

```bash
ocx --version
ocx service status
ocx status
ocx health --json
```

These commands are the supported non-billed verification boundary. A real model prompt is not required to prove the service process and proxy health.

## Credentials

Use `ocx setup` or the applicable supported `ocx login <provider>` flow when provider authorization is needed. Keep credential values inside OpenCodex. Do not pass them through OMCS arguments, environment variables, manifests, logs, issues, or chat.

OMCS neither discovers nor copies secrets. It does not invent provider aliases or claim a provider is ready from a similarly named catalog entry.

## Ownership

OpenCodex may manage Codex routing fields and its own journal/profile metadata. OMCS preserves those fields outside its narrow comment-only lifecycle marker. `omcs uninstall` does not stop, restore, uninstall, or replace OpenCodex.

## Legacy rollback

The source tree contains an attributed, ownership-safe rollback implementation for manifests created by the earlier OpenCodex-to-Codex-Router experiment. This exists to preserve user rollback state, not to advertise a current cutover path. Use it only with the exact existing manifest:

```bash
omcs migrate opencodex --rollback /absolute/path/to/opencodex-migration.json --json
```

The OpenCodex MIT notice identifies `opencodex contributors` and authoritative repository owner `lidge-jun`; no fuller personal author name is published in the inspected notice. Legacy Codex Router compatibility retains its own exact attribution. See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
