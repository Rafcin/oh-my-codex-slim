# OMCS examples

Each example starts the same way: say “use OMCS.” The route is an observable
budget decision, not a promise to use every available agent.

## A contained bug fix

```text
Use OMCS to solve this issue: retry the webhook only after a transient network failure.
```

With a reproduced local seam, `auto` selects `solo`. The architect loads
`diagnose` only if the root cause is still uncertain, writes a regression test,
implements the smallest fix, runs one focused verification path, and stops when
it is green. No Explorer, cleanup pass, or Reviewer is added without a trigger.

## A narrow public contract

```text
Use OMCS to solve this issue: document the existing invoice search pagination fields.
```

Public visibility alone does not force `full`. If the contract is already
settled, consequence and uncertainty are low, and the documentation check is
strong, `auto` remains `solo`. A public compatibility decision with meaningful
downstream impact is material consequence and may earn planning or review when
evidence is also weak or the blast radius is wide.

## A bounded feature worth delegating

```text
Use OMCS to solve this issue: add a read-only invoice search endpoint with pagination.
```

After the contract is settled, a complete isolated packet may create concrete
delegation value. `auto` can choose `delegate` and preflight only the selected
Fixer. That implementer substitutes for primary-context implementation; the
architect integrates the result and runs the final acceptance path. If the
Fixer is unavailable, narrow work visibly reroutes to `solo` without trying a
second agent.

## A high-consequence uncertain change

```text
Use OMCS to solve this issue: change payment authorization retries without double charging.
```

Material consequence plus weak evidence earns `audit` in `auto`: the architect
keeps implementation so the one auxiliary budget can fund a fresh Reviewer.
`thorough` may use `full` only after the scope is settled and delegation has
real value. A missing required Reviewer fails closed.

## A visual feature

```text
Use OMCS to solve this issue: make the empty-state recovery action understandable with keyboard and screen-reader support.
```

When visual judgment is the actual bottleneck, OMCS may select Designer as the
single `auto` auxiliary. The packet replaces primary-context design and
implementation for that surface and requires relevant visual and accessibility
proof. A narrow text or documentation edit does not select Designer merely
because users can see it.

## Cleanup and completion

`ai-slop-cleaner` activates only for a concrete named finding in changed files.
Every run uses one final verification path. Acceptance evidence is a binding
stop condition: after required behavior, tests, and review are green, OMCS
stops. A post-green correction requires a named unresolved finding and fresh
affected evidence.

OMCS does not run a real model request to make an example look complete.
`npm run verify:release`, `omcs doctor --json`, `ocx service status`, `ocx
status`, and `ocx health --json` are non-billed checks. A quota-consuming
real-model prompt requires separate explicit approval.

See [configuration](configuration.md), [execution modes](execution-modes.md),
and [agents and skills](agents-and-skills.md).
