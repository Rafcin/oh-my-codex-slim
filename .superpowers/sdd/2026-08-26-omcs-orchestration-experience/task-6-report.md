# Task 6 report — OMCS skill system

## Outcome

Shipped the canonical 16-skill catalog. `omcs` is the primary composed entrypoint; `omcs-orchestrate` is a compatibility alias. Canonical `skills/` and plugin discovery copies are identical and manifest-owned.

## RED

Before production edits, catalog/provenance/sync tests were updated and the prescribed build plus focused test command was run. The build passed; the focused suite failed as expected because the catalog and discovery tree lacked `omcs`, `context`, `codebase-design`, and `implement`; the OMCS trigger/alias and four-part skill contract were absent; anti-slop was not automatic in changed-file scope; and per-skill/supporting license metadata was absent.

## GREEN

The canonical entrypoint resolves configuration as session override, nearest project policy, global preferences, then safe defaults. It emits a concise `OMCS ROUTE` declaration with profile, route, skills, agents, risk, and approval. It owns material-decision pauses, exclusive delegation packets, automatic pre-review changed-file anti-slop, minimal secret-free receipts, verification, and review invalidation after later edits.

Each skill was authored or tuned one at a time and structurally checked for `Entry conditions`, `Scope limit`, `Exit evidence`, and `Next gate` before moving to the next. The focused catalog/sync suite then passed all 14 tests.

## Provenance

- Daniel McAteer / `DannyMac180/sol-advisor` — `37b75cad535abdd46531f0227483a8842d045ab8`, MIT; routing and review contracts.
- Matt Pocock / `mattpocock/skills` — `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`, MIT; context, design, implementation, review, TDD, diagnosis, and research adaptations.
- Alvin / `alvinunreal/oh-my-opencode-slim` — `aafd687ac8af2ef5dd50de52c7ab817c030ea6c2`, MIT; retained focused-work, verification, and supporting-resource adaptations.
- Yeachan Heo / `Yeachan-Heo/oh-my-codex` — retained MIT adaptations for anti-slop, interview, and planning.
- `code-yeongyu/oh-my-openagent` — `b48ab1086b338921ccd99a11183f91eefbb169f2`, Sustainable Use License; behavioral reference only, with no source or prompt text copied.

Exact skill-level notices include repository, source path, revision, license, status, author/copyright holder, and repository owner. `docs/upstream-sources.md` records the inspected source index. `.upstream-revisions.json` references only the pinned revisions used here.

## Verification

Passed:

- `npm run sync:skills`
- `npm run verify:skills`
- `npm run build && node --test dist/catalog/__tests__/skills.test.js dist/catalog/__tests__/skill-sync.test.js`
- `npm test` — 77 tests passed
- `npm run lint`
- `git diff --check`

The focused catalog/sync suite passed 14 tests. No external model, provider, billed smoke, deployment, or production evidence was attempted.

## Remaining boundary

The controller forbade subagent dispatch for this task, so no fresh independent agent review was performed here. Local tests and source inspection prove only the checked-in skill/catalog behavior; they do not prove provider execution or release acceptance.

## Attribution correction

Review found the Oh My OpenAgent behavioral-reference notice and source index incorrectly said that no personal author name was published. The exact pinned `package.json` at `b48ab1086b338921ccd99a11183f91eefbb169f2` declares `author: "YeonGyu-Kim"` and `license: "SUL-1.0"`.

RED: new focused tests failed because both documents lacked `SUL-1.0` and the exact package-author metadata, while the verifier did not protect that reference section.

GREEN: both documents now state `SUL-1.0 (Sustainable Use License)`, identify `YeonGyu-Kim` as the pinned package author, and explicitly avoid asserting a separate named copyright/licensor. `verify-skills` now validates every behavioral-reference notice field exactly, and a fixture test proves a corrupted package-author line is rejected.

Passed after the correction: focused catalog/sync suite (16 tests), `npm run verify:skills`, `npm test` (77 tests), `npm run lint`, and `git diff --check`.
