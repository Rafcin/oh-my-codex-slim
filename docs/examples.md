# OMCS examples

Each example starts the same way: say “use OMCS.” The profile and route are observable decisions, not magic labels.

## A contained bug fix

```text
Use OMCS to solve this issue: retry the webhook only after a transient network failure.
```

`auto` may choose `solo` if the failure is reproduced, the seam is settled, and the change is local. The architect uses `diagnose`, writes a regression test first, applies the smallest change, runs the focused suite, and records the evidence. If the affected integration contract or blast radius grows, the route escalates.

## A bounded feature

```text
Use OMCS to solve this issue: add a read-only invoice search endpoint with pagination.
```

This often earns `delegate` or `full`: Explorer maps the current request and pagination conventions; Architect agrees the public contract; one fixer owns named files; Architect reruns the relevant tests. A fresh reviewer joins when the profile or risk demands it.

## An architecture change

```text
Use OMCS to solve this issue: split the payment authorization module without changing its public behavior.
```

This is a material design and compatibility decision. OMCS pauses for approval when the seam, persistent contract, dependency, security boundary, or user-visible scope changes. After approval, `codebase-design`, `plan`, TDD, changed-file anti-slop, fresh verification, and a fresh review normally apply.

## A visual feature

```text
Use OMCS to solve this issue: make the empty-state recovery action understandable with keyboard and screen-reader support.
```

The `omcs_designer` lane may own an explicitly bounded visual surface. It verifies rendered behavior at relevant sizes, keyboard flow, focus visibility, semantic labels, contrast, and reduced-motion behavior where motion is meaningful. The architect still owns acceptance and the reviewer remains read-only.

## What stays outside the run

OMCS does not run a real model request to make an example look complete. `npm run verify:release`, `omcs doctor --json`, `ocx service status`, `ocx status`, and `ocx health --json` are non-billed checks. A quota-consuming real-model prompt requires separate explicit approval.

See [configuration](configuration.md), [execution modes](execution-modes.md), and [agents and skills](agents-and-skills.md).
