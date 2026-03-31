# Tasks: Comprehensive Test Automation and CI Quality Gates

**Input**: Design documents from /specs/002-test-automation-ci/
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/ci-test-contract.md, quickstart.md

## Format: [ID] [P?] [Story?] Description

- [P]: Parallelizable 'different files, no unmet dependencies'
- [US#]: User story mapping (US1, US2, US3)
- Every task includes exact file path(s)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish shared automation structure for CI gates and local orchestration.

- [x] T001 Create CI and automation scaffolding in .github/workflows/ci.yml, scripts/ci/.gitkeep, scripts/e2e/.gitkeep, and tests/e2e/specs/.gitkeep
- [x] T002 Create Cypress base configuration in tests/e2e/cypress.config.mjs and tests/e2e/support/e2e.ts
- [x] T003 [P] Add root gate script placeholders in package.json for lint, unit, integration, contract, accessibility, performance, and e2e
- [x] T004 [P] Add root formatting script placeholders in package.json for format and format:check
- [x] T005 [P] Add CI helper entrypoints in scripts/ci/run-gate.mjs and scripts/ci/assert-required-checks.mjs

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Implement cross-story enforcement mechanisms that all user stories depend on.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T006 Configure pre-commit bootstrap in package.json and create lint-blocking hook in .husky/pre-commit
- [x] T007 Configure staged lint execution in .lintstagedrc.json for backend and frontend TypeScript files
- [x] T008 [P] Add Prettier interoperability to backend lint config in backend/.eslintrc.json
- [x] T009 [P] Add Prettier interoperability to frontend lint config in frontend/.eslintrc.json
- [x] T010 [P] Align formatter exclusion paths in .prettierignore
- [x] T011 Implement coverage threshold plus regression checker in scripts/ci/check-unit-coverage.mjs
- [x] T012 Implement integration gate runner in scripts/ci/run-integration-gate.mjs
- [x] T013 Implement contract gate runner in scripts/ci/run-contract-gate.mjs
- [x] T014 Implement accessibility gate runner in scripts/ci/run-accessibility-gate.mjs
- [x] T015 Implement performance gate runner in scripts/ci/run-performance-gate.mjs
- [x] T016 Implement peer-review enforcement validator in scripts/ci/validate-peer-review-gate.mjs
- [x] T017 Implement Cypress zero-test guard in scripts/ci/ensure-cypress-tests-found.mjs
- [x] T018 Define performance thresholds in scripts/ci/performance-thresholds.json
- [x] T019 Document foundational gate contracts and failure semantics in docs/development.md
- [x] T020 Implement Cypress minimum-scenario-count guard (>=12 total) in scripts/ci/ensure-cypress-min-scenarios.mjs

**Checkpoint**: Foundational gate infrastructure is complete; user stories can proceed independently.

---

## Phase 3: User Story 1 - Reliable Pull Request Validation (Priority: P1) MVP

**Goal**: Enforce independently visible and merge-blocking CI quality gates for pull requests and pushes to main.

**Independent Test**: Open a pull request and verify separate required checks for lint, unit, integration, contract, accessibility, performance, cypress-map, cypress-stops, cypress-routes, and cypress-core-smoke, plus peer-review enforcement validation.

### Tests for User Story 1

- [x] T021 [P] [US1] Add backend integration gate coverage test suite in backend/tests/integration/ci-gates.integration.spec.ts
- [x] T022 [P] [US1] Add backend API contract validation test suite in backend/tests/contract/api-contract.spec.ts
- [x] T023 [P] [US1] Add frontend accessibility gate aggregation suite in frontend/tests/unit/accessibility-ci-gate.spec.tsx
- [x] T024 [P] [US1] Add performance budget smoke checks in tests/performance/ci-budgets.spec.mjs

### Implementation for User Story 1

- [x] T025 [US1] Raise backend line coverage threshold to 85 in backend/package.json
- [x] T026 [US1] Keep frontend line coverage threshold at 80 and wire regression baseline enforcement in frontend/package.json and scripts/ci/check-unit-coverage.mjs
- [x] T027 [US1] Implement root unit gate orchestration in package.json and scripts/ci/check-unit-coverage.mjs
- [x] T028 [US1] Implement CI lint and unit jobs in .github/workflows/ci.yml
- [x] T029 [US1] Implement CI integration and contract jobs in .github/workflows/ci.yml
- [x] T030 [US1] Implement CI accessibility and performance jobs in .github/workflows/ci.yml
- [x] T031 [US1] Implement CI peer-review advisory validation job in .github/workflows/ci.yml and scripts/ci/validate-peer-review-gate.mjs (branch protection remains the source of truth)
- [x] T032 [US1] Align required-check naming and merge policy documentation in specs/002-test-automation-ci/contracts/ci-test-contract.md and docs/development.md

**Checkpoint**: Pull request validation gates are independently visible, merge-blocking, and policy-aligned.

---

## Phase 4: User Story 2 - Fast Browser End-to-End Feedback (Priority: P2)

**Goal**: Run Cypress area groups in parallel with clear diagnostics and zero-test failure semantics.

**Independent Test**: Trigger CI and verify map, stops, routes, and core-smoke groups run in parallel, each with independent status, logs, and enforced nonzero test discovery.

### Tests for User Story 2

- [x] T033 [P] [US2] Add map area Cypress journeys in tests/e2e/specs/map/map-overview.cy.ts
- [x] T034 [P] [US2] Add stops area Cypress journeys in tests/e2e/specs/stops/stops-search.cy.ts
- [x] T035 [P] [US2] Add routes area Cypress journeys in tests/e2e/specs/routes/routes-search.cy.ts
- [x] T036 [P] [US2] Add core-smoke Cypress journeys in tests/e2e/specs/core-smoke/home-health.cy.ts

### Implementation for User Story 2

- [x] T037 [US2] Implement per-group Cypress runner with discovered-test logging in scripts/e2e/run-cypress-group.mjs
- [x] T038 [US2] Implement headless all-groups orchestrator in scripts/e2e/run-all-cypress-headless.mjs
- [x] T039 [US2] Configure CI Cypress matrix for map, stops, routes, and core-smoke jobs in .github/workflows/ci.yml
- [x] T040 [US2] Wire zero-test guard into each Cypress matrix job in .github/workflows/ci.yml and scripts/ci/ensure-cypress-tests-found.mjs
- [x] T041 [US2] Wire minimum-scenario-count guard (>=12) into Cypress CI flow in .github/workflows/ci.yml and scripts/ci/ensure-cypress-min-scenarios.mjs
- [x] T042 [US2] Add Cypress group summaries and artifacts for triage in .github/workflows/ci.yml

**Checkpoint**: Parallel Cypress feedback is operational with deterministic group-level diagnostics.

---

## Phase 5: User Story 3 - Consistent Local Test Execution (Priority: P3)

**Goal**: Provide root commands for all gates, headless e2e, and interactive mocked-browser debugging workflows.

**Independent Test**: From repository root, run npm run test:unit, npm run test:integration, npm run test:contract, npm run test:a11y, npm run test:performance, npm run test:e2e, and npm run test:e2e:open successfully.

### Tests for User Story 3

- [x] T043 [P] [US3] Add root command smoke coverage test in tests/scripts/root-commands.spec.mjs
- [x] T044 [P] [US3] Add interactive-mode preflight test in tests/scripts/e2e-open-preflight.spec.mjs

### Implementation for User Story 3

- [x] T045 [US3] Add root unit/integration/contract/accessibility/performance command scripts in package.json
- [x] T046 [US3] Add root headless and interactive Cypress scripts in package.json
- [x] T047 [US3] Add root full-suite test command chaining all constitution-automatable gates in package.json
- [x] T048 [US3] Implement interactive mocked-browser launcher in scripts/e2e/open-cypress-interactive.mjs
- [x] T049 [US3] Document root command usage and examples in README.md and specs/002-test-automation-ci/quickstart.md
- [x] T050 [US3] Document pre-commit, Prettier, and ESLint interoperability troubleshooting in docs/development.md
- [x] T051 [US3] Add SC-003 contributor validation protocol and timing capture template in docs/development.md and specs/002-test-automation-ci/quickstart.md

**Checkpoint**: Local execution parity with CI is complete for unattended and interactive workflows.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency checks, deduplication, and evidence capture across all stories.

- [x] T052 [P] Remove duplicated gate orchestration logic by consolidating integration/contract execution into scripts/ci/run-gate.mjs
- [x] T053 [P] Validate workflow job names versus contract-required names in .github/workflows/ci.yml and specs/002-test-automation-ci/contracts/ci-test-contract.md
- [x] T054 Validate quickstart command sequence against implemented scripts in specs/002-test-automation-ci/quickstart.md
- [ ] T055 Capture Cypress parallel timing improvement and gate metrics in specs/002-test-automation-ci/research.md
- [ ] T056 Capture SC-003 contributor-sample evidence report in specs/002-test-automation-ci/research.md

---

## Dependencies & Execution Order

### Phase Dependencies

- Phase 1 (Setup): No dependencies; starts immediately.
- Phase 2 (Foundational): Depends on Phase 1; blocks all user stories.
- Phase 3 (US1): Depends on Phase 2.
- Phase 4 (US2): Depends on Phase 2; can run in parallel with US1 after foundational completion.
- Phase 5 (US3): Depends on Phase 2; can run in parallel with US1 and US2.
- Phase 6 (Polish): Depends on completion of selected user stories.

### User Story Dependencies

- US1 (P1): Starts after Phase 2; no dependency on US2 or US3.
- US2 (P2): Starts after Phase 2; no dependency on US1 or US3.
- US3 (P3): Starts after Phase 2; no dependency on US1 or US2.

### Within Each User Story

- Test tasks are created before implementation tasks and must fail before implementation begins.
- CI/workflow wiring follows test and script readiness.
- Story checkpoint must pass before marking story complete.

### Parallel Opportunities

- Phase 1 parallel tasks: T003, T004, T005.
- Phase 2 parallel tasks: T008, T009, T010.
- US1 parallel test tasks: T021, T022, T023, T024.
- US2 parallel spec tasks: T033, T034, T035, T036.
- US3 parallel verification tasks: T043, T044.
- Polish parallel tasks: T052, T053.

---

## Parallel Examples by User Story

### US1 Parallel Batch

- T021 + T022 + T023 + T024

### US2 Parallel Batch

- T033 + T034 + T035 + T036

### US3 Parallel Batch

- T043 + T044

---

## Implementation Strategy

### MVP First (US1)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 (US1) and validate required CI gate topology.
3. Confirm merge blocking and peer-review validation behavior.

### Incremental Delivery

1. Deliver US1 for mandatory gate enforcement.
2. Deliver US2 for Cypress parallel throughput.
3. Deliver US3 for root-command parity and interactive debugging.
4. Complete Phase 6 polish and evidence capture.

### Team Parallelization

1. Engineer A: CI workflow and gate orchestration (.github/workflows/ci.yml, scripts/ci/).
2. Engineer B: Cypress grouping and runners (tests/e2e/, scripts/e2e/).
3. Engineer C: Unit/integration/contract/a11y/performance test suites (backend/tests/, frontend/tests/, tests/performance/).
