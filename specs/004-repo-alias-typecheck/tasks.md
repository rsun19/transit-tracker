# Tasks: Repository-Wide Alias Policy & Type Diagnostics Command

**Input**: Design documents from `/specs/004-repo-alias-typecheck/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prepare repository tooling surfaces for typecheck and alias-validation work.

- [x] T001 Add root script placeholders for repository diagnostics in package.json
- [x] T002 [P] Add backend diagnostics script placeholders in backend/package.json
- [x] T003 [P] Add frontend diagnostics script placeholders in frontend/package.json
- [x] T004 Create CI helper script scaffold in scripts/ci/typecheck-workspace.mjs

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish shared policy and deterministic validation baseline before story delivery.

**⚠️ CRITICAL**: Complete this phase before any user story implementation.

- [x] T005 Define repository alias policy documentation in docs/development.md
- [x] T006 [P] Align backend alias mapping conventions in backend/tsconfig.json
- [x] T007 [P] Align frontend alias mapping conventions in frontend/tsconfig.json
- [x] T008 Add deterministic diagnostics-validation command contract in package.json

**Checkpoint**: Baseline alias policy and command contract are in place.

---

## Phase 3: User Story 1 - Run one command to verify repository-wide type health (Priority: P1) 🎯 MVP

**Goal**: Provide one root command (`npm run typecheck`) that aggregates backend + frontend diagnostics and exits non-zero on any failure.

**Independent Test**: Run `npm run typecheck` from repository root and confirm diagnostics for backend and frontend are both reported.

### Tests for User Story 1 (required by feature)

- [x] T009 [US1] Add backend no-emit typecheck command in backend/package.json
- [x] T010 [US1] Add frontend no-emit typecheck command in frontend/package.json
- [x] T011 [US1] Implement aggregate root typecheck runner in scripts/ci/typecheck-workspace.mjs
- [x] T012 [US1] Wire root `npm run typecheck` to aggregate runner in package.json
- [x] T013 [US1] Add CI job step invoking root `npm run typecheck` in .github/workflows/ci.yml

**Checkpoint**: Root typecheck command works locally and in CI.

---

## Phase 4: User Story 2 - Enforce alias usage across repository projects (Priority: P2)

**Goal**: Enforce deep-relative-import violations where aliases apply in both backend and frontend.

**Independent Test**: Run lint in backend and frontend with controlled deep-relative imports and confirm violations are reported.

### Tests for User Story 2 (required by feature)

- [x] T014 [US2] Add `eslint-plugin-no-relative-import-paths` to backend devDependencies in backend/package.json
- [x] T015 [US2] Add `eslint-plugin-no-relative-import-paths` to frontend devDependencies in frontend/package.json
- [x] T016 [US2] Configure backend alias-validation lint rule in backend/.eslintrc.json
- [x] T017 [US2] Configure frontend alias-validation lint rule in frontend/.eslintrc.json
- [x] T018 [US2] Add backend lint verification command for alias policy in backend/package.json
- [x] T019 [US2] Add frontend lint verification command for alias policy in frontend/package.json

**Checkpoint**: Alias policy is enforceable and validated in both projects.

---

## Phase 5: User Story 3 - Validate IDE alias diagnostics behavior (Priority: P3)

**Goal**: Provide reproducible CLI diagnostics validation that confirms alias imports resolve and broken alias setups fail predictably.

**Independent Test**: Run diagnostics validation task and confirm pass path (valid alias imports) and fail path (intentionally broken alias) are both deterministic.

### Tests for User Story 3 (required by feature)

- [x] T020 [US3] Create backend alias-resolution sample fixture in scripts/ci/fixtures/backend-alias-sample.ts
- [x] T021 [US3] Create frontend alias-resolution sample fixture in scripts/ci/fixtures/frontend-alias-sample.ts
- [x] T022 [US3] Implement diagnostics validation workflow in scripts/ci/validate-alias-diagnostics.mjs
- [x] T023 [US3] Add root diagnostics validation command in package.json
- [x] T024 [US3] Document CLI diagnostics validation workflow in specs/004-repo-alias-typecheck/quickstart.md

**Checkpoint**: IDE/TypeScript alias diagnostics behavior is reproducibly validated.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency, onboarding clarity, and parity checks.

- [x] T025 [P] Update repository onboarding for typecheck and alias diagnostics in README.md
- [x] T026 [P] Add troubleshooting section for stale TS diagnostics in docs/development.md
- [x] T027 Validate local and CI parity for root `npm run typecheck` and diagnostics validation in .github/workflows/ci.yml
- [x] T028 Run quickstart validation flow and correct command examples in specs/004-repo-alias-typecheck/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: Can start immediately.
- **Phase 2 (Foundational)**: Depends on Setup; blocks all user stories.
- **Phase 3 (US1)**: Depends on Foundational.
- **Phase 4 (US2)**: Depends on Foundational.
- **Phase 5 (US3)**: Depends on Foundational and requires US1 command path to exist.
- **Phase 6 (Polish)**: Depends on all selected stories being complete.

### User Story Dependencies

- **US1 (P1)**: Independent after Foundational; delivers MVP.
- **US2 (P2)**: Independent after Foundational; can proceed in parallel with US1 once base command contract exists.
- **US3 (P3)**: Depends on US1 aggregate command and benefits from US2 alias enforcement.

### Parallel Opportunities

- Setup: T002 and T003 can run in parallel.
- Foundational: T006 and T007 can run in parallel.
- US2: T014 and T015 can run in parallel.
- Polish: T025 and T026 can run in parallel.

---

## Parallel Example: User Story 1

```bash
# Run in parallel after T008
Task: "Add backend no-emit typecheck command in backend/package.json" (T009)
Task: "Add frontend no-emit typecheck command in frontend/package.json" (T010)
```

## Parallel Example: User Story 2

```bash
# Dependency install tasks can run together
Task: "Add eslint-plugin-no-relative-import-paths to backend devDependencies in backend/package.json" (T014)
Task: "Add eslint-plugin-no-relative-import-paths to frontend devDependencies in frontend/package.json" (T015)
```

## Parallel Example: User Story 3

```bash
# Fixture creation can run in parallel
Task: "Create backend alias-resolution sample fixture in scripts/ci/fixtures/backend-alias-sample.ts" (T020)
Task: "Create frontend alias-resolution sample fixture in scripts/ci/fixtures/frontend-alias-sample.ts" (T021)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Setup and Foundational phases.
2. Deliver US1 (`npm run typecheck` local + CI wiring).
3. Validate independent test for US1 before expanding scope.

### Incremental Delivery

1. Deliver US1 for shared diagnostics orchestration.
2. Deliver US2 for repository-wide alias enforcement.
3. Deliver US3 for reproducible diagnostics validation.
4. Finish with Polish parity and onboarding updates.

### Parallel Team Strategy

1. Team completes Setup + Foundational together.
2. Then split by story:
   - Developer A: US1
   - Developer B: US2
   - Developer C: US3
3. Rejoin for Phase 6 parity and docs validation.
