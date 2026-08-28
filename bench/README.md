# OMCS benchmark assets

The checked-in `prompt-refinement-pilot.json` is a public calibration canary for paired plain-Codex versus OMCS runs.

- `fixtures/` contains the isolated starting repositories visible to the agent.
- `graders/` contains declared external behavior graders that are frozen once and mounted read-only into a networkless, digest-pinned container; they are never copied into the agent workspace.
- `oracles/` contains reference solutions used only by the repository's non-model task-quality test.

Read [`docs/benchmarking.md`](../docs/benchmarking.md) before executing the suite. Planning, dry runs, fixture validation, and oracle validation consume no model quota. Every 36-run comparison requires separate explicit approval.

The first valid public matrix and its limitations are documented in the [August 27, 2026 mathematical report](../docs/benchmark-results/2026-08-27-prompt-refinement-pilot.md), with [sanitized pair-level observations](../docs/benchmark-results/prompt-refinement-pilot-2026-08-27.csv).
