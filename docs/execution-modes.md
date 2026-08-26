# OMCS execution modes

OMCS is a workflow, not a fixed multi-agent tax. Start with `auto` and let the observed task earn more process.

## Profiles

`auto` is the normal default. It routes a small, settled local fix narrowly and raises gates for public interfaces, persistent data, broad changes, uncertainty, or generated-code risk.

`fast` prefers the architect working directly or one bounded implementer. It still requires the safety and correctness checks that apply to the change.

`thorough` raises design, TDD, changed-file anti-slop, documentation, fresh verification, and fresh-review gates.

`council` is explicit-only. It asks distinct, proven model lanes for read-only advice before selecting an ordinary delivery route. It does not activate from any other profile, does not implement, and fails closed if diversity cannot be proven without inspecting secrets.

## Delivery routes

| Route | When it fits | Delivery contract |
| --- | --- | --- |
| `solo` | Settled, small work with low blast radius | Architect owns implementation, verification, and self-review. |
| `delegate` | A complete bounded packet can be handed to one implementer | Architect owns the acceptance evidence. |
| `audit` | A fresh opinion is justified, but delegation is not | Architect implements; fresh reviewer audits the actual change. |
| `full` | Higher-risk, multi-surface, or public-interface work | Implementer delivers, architect verifies, fresh reviewer audits. |

Explorer, Librarian, and Oracle are supporting read-only lanes. Their use does not turn a route into a different route, and they never become acceptance owners.

## Visible route declaration

OMCS emits this concise declaration after resolving configuration and before task tools:

```text
OMCS ROUTE
profile: auto
mode: full
risk: new subsystem with public interfaces and persistent configuration
skills: context, codebase-design, plan, tdd, verification, code-review
agents: architect → explorer + librarian → terra-fixer → reviewer
approval: material-decisions
```

The declaration can escalate with new evidence. A route cannot silently become cheaper. A missing role, conflicting model/effort contract, unavailable fresh reviewer, unsafe write scope, stale verification, or unresolved material decision stops the run rather than substituting a hidden behavior.

## Adaptive gates

The usual lifecycle is:

```text
intent → config / route → context / grill → explore / research → design / material decision
  → plan → TDD implementation → anti-slop / simplify → verification → risk-gated review → acceptance
```

A one-file regression fix might go from route declaration to TDD and verification. A new subsystem normally uses the full sequence. Anti-slop only inspects accumulated changed files and may edit only when it removes a concrete smell; every edit requires affected checks to run again. A reviewer verdict is invalid after an edit, so the architect re-verifies and obtains a fresh review when required.

See [agents and skills](agents-and-skills.md), [configuration](configuration.md), and [examples](examples.md).
