# OMCS execution modes

OMCS is a thin workflow, not a fixed multi-agent tax. `auto` and `fast` default
to `solo`; a task must earn an auxiliary through concrete critical-path value or
required independent review.

## Independent routing signals

OMCS separates consequence from uncertainty:

- **Consequence** is material for security, credentials, irreversible or
  external state, persistent data, architecture, dependencies, or compatibility
  with meaningful downstream impact. A narrow public or user-visible surface
  is not material by default.
- **Uncertainty** is material when requirements, root cause, interfaces, or the
  acceptance oracle remain weak. Otherwise it is low.
- **Blast radius** describes the actual changed surfaces and downstream
  consumers: narrow, moderate, or wide.
- **Delegation value** exists only when a complete bounded packet removes a
  real bottleneck or uses a needed specialist capability. Being technically
  delegable is not enough.

In `auto`, independent review is required when material consequence combines
with material uncertainty or wide blast radius. This avoids equating every
important-looking label with a mandatory multi-agent route.

## Profiles

| Profile | Auxiliary budget | Review contract |
| --- | ---: | --- |
| `auto` | At most one auxiliary | Risk-gated by consequence plus uncertainty or width. |
| `fast` | At most one auxiliary | Same safety gate; fewer optional disciplines. |
| `thorough` | One implementer plus one reviewer | Fresh review always; implementation stays direct unless delegation has value. |
| `council` | Explicit read-only advisers, then the thorough delivery budget | Two distinct advisory lanes must be proven; fresh delivery review remains required. |

Council is an advisory overlay, not a delivery route. It never activates from
another profile and does not implement.

## Delivery routes

| Route | When it fits | Delivery contract |
| --- | --- | --- |
| `solo` | Default for settled work | Architect implements, verifies, and stops after acceptance evidence is green. |
| `delegate` | A settled bounded packet has concrete delegation value | One implementer substitutes for architect implementation; architect integrates and verifies. |
| `audit` | Independent review is required within a one-auxiliary budget | Architect implements and verifies; fresh Reviewer audits. |
| `full` | Thorough work benefits from both implementation delegation and review | One implementer delivers; architect verifies; fresh Reviewer audits. |

Explorer, Librarian, and Oracle are optional read-only specialists. In `auto`, a
supporting specialist consumes the one auxiliary budget, so it is never stacked
with an implementer or reviewer.

## Capability fallback

OMCS chooses a candidate first, then preflights only that selected auxiliary.
It does not enumerate every role or try a chain of replacements.

- An unavailable optional implementer or supporting specialist visibly
  reroutes narrow work to `solo`.
- A missing required Reviewer fails closed; the architect cannot silently
  self-certify an `audit` or `full` result.
- Council fails closed without two proven distinct advisory lanes.
- Capability evidence contains role availability only and never provider
  credentials.

## Visible route declaration

```text
OMCS ROUTE
profile: auto
mode: solo
risk: low consequence; low uncertainty; narrow blast radius
skills: tdd, verification
agents: architect
budget: 1 auxiliary; one final verification path; stop after green
approval: material-decisions
```

A route can escalate when new evidence changes consequence, uncertainty, blast
radius, or specialist value. Optional-capability fallback is the one supported
visible simplification.

## Binding execution budget

An auxiliary substitutes for the corresponding primary-context work. The
architect inspects its evidence at the integration boundary but does not repeat
the same mapping, research, implementation, or review.

Every run uses one final verification path proportionate to the acceptance
claim. A command repeats only after relevant inputs changed or prior evidence
was incomplete. Anti-slop cleanup runs only for a concrete named finding in
changed files. Acceptance evidence is a binding stop condition: once required
behavior, tests, and review are green, OMCS stops. A named post-green finding
may justify one correction, which invalidates affected verification and review.

See [agents and skills](agents-and-skills.md), [configuration](configuration.md),
and [examples](examples.md).
