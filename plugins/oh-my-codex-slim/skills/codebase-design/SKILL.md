---
name: codebase-design
description: Use when a module boundary, interface, domain model, or architecture change needs a durable design decision before implementation.
---

# Codebase Design

Design deep modules: concentrate behavior behind a small, testable interface at a clean seam.

## Entry conditions

Use for a new or changed module, public contract, domain model, integration seam, or architecture decision. Read callers, tests, and local vocabulary before naming the seam.

## Scope limit

Choose the smallest interface that gives callers leverage and keeps knowledge local. Do not redesign unrelated modules, mistake a directory for a boundary, or invent abstraction before a concrete behavior and caller need justify it.

## Exit evidence

State the module responsibility, interface, invariants and error behavior, owning files, adapters or external boundaries, public test seam, compatibility decision, and rejected alternative when it affected the choice.

## Next gate

Use `plan` for multi-step, delegated, persistent, or risky work. Otherwise hand the agreed seam to `tdd` and `implement` through the declared OMCS route.
