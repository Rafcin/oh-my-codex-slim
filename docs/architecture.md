# Architecture

OMCS has five bounded layers:

1. The local Codex plugin distributes skills, inert hooks metadata, MCP metadata, and App/CLI discovery metadata.
2. The `omcs` CLI owns setup, explicit update, doctor, status, agents, and uninstall.
3. Risk-gated orchestration selects an explicit profile, delivery route, native roles, and focused skill gates.
4. `omcs_code_intel` provides six deterministic AST, symbol, reference, diagnostic, and codemap tools without downloading language servers.
5. OpenCodex is the separately owned external-model transport. OMCS does not read, transfer, log, or store provider credentials.

## Ownership

The OMCS block between `# omcs:begin` and `# omcs:end` is a comment-only lifecycle marker. Codex CLI exclusively owns `[marketplaces.omcs-local]`. Bytes outside the marker remain user-owned. Native agent ownership is exact-file and digest-bound under `agents/omcs-*.toml`. Lifecycle operations reject symbolic-link, hard-link, and ownership ambiguity, write atomically, keep timestamped config backups, and roll back partial failure.

Runtime project state belongs under `.omcs/`; local execution receipts under `.gjc/` and `.superpowers/sdd/` are also private runtime state. All three roots are ignored by Git. User installation metadata belongs under `${CODEX_HOME}/oh-my-codex-slim/`. OpenCodex state and legacy migration backups are never OMCS uninstall targets.

## Agent and model boundary

The eight OMCS agents are native Codex definitions. OpenCodex owns primary external-model routing, provider selection, accounts, quotas, and any OpenCodex-managed agent behavior. OMCS does not generate provider-specific agent files or infer model eligibility from credentials.

## Orchestration boundary

An OMCS run starts with an auditable declaration of profile, route, independent consequence and uncertainty signals, skills, agents, budget, and approval posture. `auto` and `fast` default to `solo` and use at most one auxiliary. The architect owns intent, route selection, packet contracts, integration, fresh verification, acceptance, and the stop decision. Delivery is one of `solo`, `delegate`, `audit`, or `full`; council is explicit-only, read-only advice before a normal route.

An auxiliary substitutes for corresponding primary-context work. Capability preflight happens only after one is selected; optional unavailability can reroute narrow work to `solo`, while unavailable required review fails closed. Focused skills load only from observed triggers, anti-slop requires a concrete named changed-file finding, and one final verification path leads to a binding stop condition. A settled one-file fix therefore stays direct while material consequence combined with uncertainty or wide blast radius earns independent review. [Execution modes](execution-modes.md) and [agents and skills](agents-and-skills.md) define these contracts.

## MCP safety boundary

The MCP host authorizes the canonical project root at process launch; a tool caller cannot select a different accessible directory. File inspection is bounded per file, codemap traversal is bounded by file count, bytes, and depth, child processes receive a minimal environment, and responses redact external-command details. The earlier dependency-clone helper remains internal legacy source and is not exposed or shipped until it has a complete resource-quota design.

## Legacy Codex Router compatibility

Attributed Codex Router adapter and migration code remains solely to preserve recoverability for users who already created OMCS migration state. It is not the active transport, is not offered by the normal CLI lifecycle, and must not be used to invent provider aliases or transfer credentials.

## Release split

`npm run verify:release` is offline acceptance. It never invokes model calls, provider endpoints, network checkout, update, panel, service mutation, or credential commands. Fresh desktop-app/CLI discovery is separate, and any billed model smoke requires explicit approval.

See [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) for exact upstream authors, contributors, owners, revisions, and adaptation status.
