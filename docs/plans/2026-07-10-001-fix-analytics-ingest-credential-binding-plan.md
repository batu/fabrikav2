---
title: Bind Analytics Ingest Credentials to Game and Environment - Superseded Plan
type: fix
date: 2026-07-10
origin: trello-card:csYLD5PK
trello: https://trello.com/c/csYLD5PK
status: superseded
superseded_by: docs/plans/2026-07-10-001-fix-analytics-ingest-credential-scoping-plan.md
---

# Superseded: Bind Analytics Ingest Credentials to Game and Environment

> **Do not implement this file.** It is retained only as a historical pointer.

This draft was superseded after the card's contract red-team found conflicting
legacy-fallback, duplicate-key, denial-oracle, ordering, and mobile-rotation
semantics. The single canonical implementation contract is:

`docs/plans/2026-07-10-001-fix-analytics-ingest-credential-scoping-plan.md`

That canonical plan requires fail-closed structured configuration with no
runtime flat-key fallback, permanent canonical duplicate poisoning, one public
`forbidden_scope` response with internal reason metrics, explicit denial
precedence, and per-environment mobile-safe overlap/adoption/rollback gates.
