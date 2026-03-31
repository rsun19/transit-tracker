# Implementation Plan: Comprehensive Test Automation and CI Quality Gates

**Branch**: `002-test-automation-ci` | **Date**: 2026-03-30 | **Spec**: `/specs/002-test-automation-ci/spec.md`
**Input**: Feature specification from `/specs/002-test-automation-ci/spec.md`

## Summary

Deliver a comprehensive, constitution-aligned quality system for this monorepo by expanding test depth and CI orchestration across backend and frontend. The implementation includes root-level command ergonomics, Cypress area-based parallelization, stricter coverage enforcement, and explicit in-scope delivery of all mandatory constitution quality gates: lint, unit, integration, contract, accessibility, performance, and peer review.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20+ (backend NestJS 10, frontend Next.js 14)  
**Primary Dependencies**: NestJS, Next.js, Jest, ESLint, Prettier, Cypress (planned for e2e), jest-axe, GitHub Actions  
**Storage**: PostgreSQL 16 + PostGIS, Redis 7, repository files for CI/report artifacts  
**Testing**: Jest (unit, backend e2e/integration patterns), contract test suite, Cypress area e2e, jest-axe accessibility checks, CI performance checks/budgets  
**Target Platform**: Linux CI runners and local macOS/Linux developer environments via npm and Docker Compose  
**Project Type**: Web application monorepo (backend + frontend + worker + shared root orchestration)  
**Performance Goals**: Maintain constitution budgets (p95 API <= 200 ms, p95 initial load <= 3 s cold 4G, p95 navigation <= 1 s, refresh latency <= 5 s, initial bundle <= 150 KB gzipped) and reduce Cypress validation wall time by >= 40% via parallel groups  
**Constraints**: No lint warnings, enforced coverage (backend >= 85% lines, frontend >= 80% lines, no regression vs main), zero-test Cypress groups fail, mandatory CI gates for all constitution checks, branch protection enforces peer review  
**Scale/Scope**: Four Cypress groups (map, stops, routes, core-smoke), at least 12 e2e scenarios, root command contracts for lint/unit/e2e/format, CI execution on pull requests and pushes to main

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Pre-Phase 0 Gate Review

| Constitution Area                | Status | Evidence in This Plan                                                                                                                                |
| -------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Code Quality                  | PASS   | Root lint and Prettier gates are in scope; formatting and lint compatibility are explicit implementation responsibilities.                           |
| II. Testing Standards            | PASS   | Unit, integration, contract, and Cypress responsibilities are all in scope with quantitative coverage/test-group requirements.                       |
| III. User Experience Consistency | PASS   | Accessibility automation is explicitly in scope, with existing jest-axe tests extended as a required gate.                                           |
| IV. Performance Requirements     | PASS   | Performance gate is in scope with constitution thresholds adopted as non-optional acceptance constraints.                                            |
| Quality Gates (1-7)              | PASS   | Lint/format, unit, integration, contract, accessibility, performance, and peer review are all included as mandatory implementation responsibilities. |

### Phase 1 Re-Check (Post-Design)

| Constitution Area                | Status | Design Alignment                                                                                |
| -------------------------------- | ------ | ----------------------------------------------------------------------------------------------- |
| I. Code Quality                  | PASS   | Contracts and quickstart require lint + formatter checks and root script consistency.           |
| II. Testing Standards            | PASS   | Data model and contract include unit/integration/contract gate entities and blocking semantics. |
| III. User Experience Consistency | PASS   | Accessibility gate remains mandatory and explicitly blocking in CI contract.                    |
| IV. Performance Requirements     | PASS   | Performance gate is defined as blocking with threshold-based checks and reporting requirements. |
| Quality Gates (1-7)              | PASS   | All seven gates remain in scope with no exceptions and no deferred tracking entries.            |

## In-Scope Implementation Responsibilities

1. Lint and format gate automation with zero-warning policy and Prettier compatibility.
2. Unit gate automation with backend/frontend coverage thresholds and regression checks.
3. Integration gate automation including area-partitioned Cypress workflows and backend integration suite execution.
4. Contract gate automation for API/schema stability checks on every CI run.
5. Accessibility gate automation in CI with WCAG 2.1 AA failure behavior.
6. Performance gate automation with constitution thresholds and regression reporting.
7. Peer review gate enforcement through branch protection (minimum one non-author approval).

## Project Structure

### Documentation (this feature)

```text
specs/002-test-automation-ci/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── ci-test-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── modules/
│   ├── common/
│   └── config/
└── tests/

frontend/
├── src/
│   ├── app/
│   ├── components/
│   └── lib/
└── tests/

tests/
└── e2e/                     # planned Cypress workspace for this feature

scripts/
├── ci/                      # planned CI helper scripts
└── e2e/                     # planned e2e runner/orchestration scripts

.github/
└── workflows/
    └── ci.yml               # planned unified gate workflow
```

**Structure Decision**: Use the existing backend/frontend monorepo layout and add root-level orchestration directories (`tests/e2e`, `scripts/ci`, `scripts/e2e`) to implement shared quality gates without changing service boundaries.

## Complexity Tracking

No constitution violations or exceptions are required for this plan. This section intentionally has no tracked entries.
