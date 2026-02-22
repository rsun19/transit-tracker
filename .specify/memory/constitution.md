<!--
Sync Impact Report
- Version change: unversioned -> 1.0.0
- Modified principles: initialized (new) -> Code Quality & Maintainability; Test Discipline & Coverage; Consistent User Experience & API Behavior; Performance & Reliability
- Added sections: Non-Functional Standards; Delivery Workflow & Quality Gates
- Removed sections: Placeholder Principle 5 slot
- Templates requiring updates: .specify/templates/plan-template.md ✅ updated | .specify/templates/spec-template.md ✅ updated | .specify/templates/tasks-template.md ✅ updated | .specify/templates/commands/* ⚠ not present
- Follow-up TODOs: none
-->

# Transit Tracker Constitution

## Core Principles

### I. Code Quality & Maintainability
- All changes MUST keep linting and formatting clean (ruff for Python, eslint/formatter for frontend); new Python/TypeScript code MUST be type-annotated.
- Work MUST stay small and focused (aim <400 LOC per PR); each new module/function includes concise docstrings or usage notes for reviewers.
- Remove dead code and unused dependencies before merge; duplicated config MUST be centralized rather than copied across services.
Rationale: Tight scope and consistent style reduce regressions, keep the monorepo approachable, and speed up reviews.

### II. Test Discipline & Coverage
- Every behavior change ships with automated tests; bug fixes start with a failing test that reproduces the issue before code changes.
- Unit tests cover logic paths; integration tests cover API contracts and the alerts/streaming pipeline. Minimum 90% statement coverage for backend Python and frontend TypeScript modules; coverage MUST not decrease.
- Critical flows (real-time alert ingestion, public API responses, primary user journeys) require integration or contract tests before enabling feature flags by default.
Rationale: Transit data freshness and correctness are non-negotiable; tests are the guardrail for rapid iteration.

### III. Consistent User Experience & API Behavior
- API responses MUST use consistent naming, status codes, and error envelopes: {"error":{"code","message","details"}} for failures; no breaking schema changes without a versioned path or negotiated format.
- Frontend interactions MUST honor shared design tokens, accessible semantics (WCAG AA), and complete states (loading, empty, error) with actionable messaging.
- Data displayed to users MUST include freshness indicators and consistent timestamp formatting (ISO 8601 UTC); flows MUST degrade gracefully with retries/timeouts at network boundaries.
Rationale: Predictable APIs and UX reduce support burden and help riders trust transit information.

### IV. Performance & Reliability
- Backend endpoints MUST meet p95 latency ≤400ms for standard queries and ≤1s for heavy filters at current scale; alert/stream pipelines MUST process events end-to-end within 2s and keep queue lag monitored.
- Frontend pages MUST target LCP ≤2.5s and TTI ≤3s on broadband; avoid long tasks >50ms on the main thread by deferring non-critical work.
- Observability is required: structured logging, metrics for latency/error rate/queue lag, and alerts on SLO breaches; implement backpressure and graceful degradation rather than dropping data silently.
Rationale: Riders rely on timely, reliable updates; performance budgets and instrumentation prevent silent failures.

## Non-Functional Standards
- Stack: Python 3.11+ backend (Django/ASGI), TypeScript/Next.js frontend; commands in README and backend/README/AGENTS govern local execution.
- Dependencies MUST be pinned/locked; third-party API usage documents rate limits, retries, and fallbacks.
- Security: secrets stay out of VCS; use environment configuration, least-privilege credentials, and input validation on all external data.
- Data: timestamps and timezones are explicit (ISO 8601 UTC); data presented to users MUST show last-updated/freshness when relevant.

## Delivery Workflow & Quality Gates
- Constitution Check before implementation: declare lint/type tooling, planned tests and coverage (Principle II), API/UX contract impacts (Principle III), and performance budgets/telemetry (Principle IV).
- Development flow: design/spec → tests → implementation → self-review (lint, format, type checks, coverage) → peer review that enforces the Core Principles and Non-Functional Standards → merge.
- PRs MUST include test commands/output; performance-sensitive changes include profiling or benchmark notes; releases document monitoring/alert updates and rollback plan for risky changes.

## Governance
- This constitution supersedes other practices; conflicts resolve in favor of stricter guidance.
- Amendments require documenting the change, rationale, risk/mitigation, and updating templates/guides; version bumps follow semantic rules (MAJOR for removals/relaxations, MINOR for new or expanded principles, PATCH for clarifications).
- Compliance: reviewers block merges that violate principles unless a documented risk acceptance is recorded in the PR; violations must be time-bound with an owner.
- Runtime guidance lives in README.md and backend/README.md/AGENTS.md; update them if governance alters required commands or environments.

**Version**: 1.0.0 | **Ratified**: 2026-02-22 | **Last Amended**: 2026-02-22
