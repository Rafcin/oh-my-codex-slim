# Task 3 report — OMCS execution policy kernel

## Scope

Implemented profiles, four-mode delivery routing, adaptive skill gates,
explicit diversity-gated council advisory state, and the machine-auditable
route declaration. The implementation only changes the Task 3-owned policy,
declaration, risk, tests, and package entries.

## RED evidence

Command:

```text
npm run build && node --test dist/orchestration/__tests__/risk.test.js dist/orchestration/__tests__/policy.test.js
```

Observed result: the TypeScript build failed before test execution with
`TS2307` errors for the intentionally absent `../policy.js` and
`../declaration.js` modules in the new focused tests. This was the expected
missing-behavior RED state.

## GREEN evidence

Command:

```text
npm run build && node --test dist/orchestration/__tests__/risk.test.js dist/orchestration/__tests__/policy.test.js dist/orchestration/__tests__/declaration.test.js
```

Result: 12 tests passed, 0 failed.

The focused coverage proves:

- `RouteMode` permits only `solo`, `delegate`, `audit`, and `full`.
- Council is explicit, read-only, and enabled only by proven distinct supported
  native model lanes; absent or invalid diversity evidence fails closed to the
  normal thorough route.
- Fast retains verification while preferring direct delivery; auto adapts to
  observed work signals; thorough/council select the required gates.
- Anti-slop is selected for thorough, audit, full, and concrete smell risk and
  carries the changed-file/before-review/reverification contract.
- The declaration uses the exact stable `OMCS ROUTE` layout with `profile`,
  `mode`, `risk`, `skills`, `agents`, and `approval`, and cannot render runtime
  metadata, paths, or secrets.

## Lint evidence

Command:

```text
npm run lint
```

Result: `Checked 302 files in 42ms. No fixes applied.`

## Full evidence

Command:

```text
npm test
```

Result: 62 tests passed, 0 failed across 10 suites.

Additional hygiene check:

```text
git diff --check
```

Result: no whitespace errors.

## Boundaries and concerns

No Router/OpenCode runtime, LazyCodex, telemetry, tmux, daemon, credential,
provider, or billed-model behavior was added or exercised. Council diversity
proof is intentionally limited to known native lane identifiers supplied by
non-secret supported metadata; unsupported or duplicate values cannot enable
the overlay.

## Fix round 1/5

### RED evidence

Command:

```text
npm run build && node --test dist/orchestration/__tests__/risk.test.js dist/orchestration/__tests__/policy.test.js dist/orchestration/__tests__/declaration.test.js
```

Observed result: the TypeScript build failed with the expected missing typed
surface errors for `needsRepositoryMapping`, `supportingAgents`, and the
structured risk spread. The tests had been written to require the three review
findings before the policy implementation was changed.

### GREEN evidence

The same focused command passed after the implementation. Result: 16 tests
passed, 0 failed across risk, policy, and declaration suites.

Coverage added in this round proves:

- Council state is exactly `disabled`, `unavailable`, or `enabled`; an explicit
  council request without proven diversity is rendered as
  `unavailable (fail-closed)`, while enabled state exposes only finite native
  lane and read-only adviser identities.
- Risk is structured finite evidence, not a caller-controlled string. The
  renderer validates every emitted policy field and rejects a direct hostile
  cast containing an absolute user path, newline, environment syntax, token
  text, or prompt text without interpolating it.
- Explorer, librarian, and oracle selection comes from typed supporting-work
  signals. They appear in the declaration separately from the route and do not
  become implementer, reviewer, or council acceptance owners.

### Lint and full evidence

```text
npm run lint
```

Result: `Checked 302 files in 40ms. No fixes applied.`

```text
npm test
```

Result: 66 tests passed, 0 failed across 10 suites.

`git diff --check` also passed with no whitespace errors.

### Note

The review's minor tautological `RouteMode` test remains ledgered for final
review and was not broadened in this focused corrective change.
