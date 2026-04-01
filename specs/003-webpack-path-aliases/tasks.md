# Tasks: Webpack Path Aliases & ESLint Enforcement

**Input**: Design documents from `/specs/003-webpack-path-aliases/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, quickstart.md

**Tests**: No dedicated test files were requested in the spec. Validation is performed via existing lint/build commands.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install and baseline tooling needed for alias-lint enforcement.

- [ ] T001 Add `eslint-plugin-no-relative-import-paths` to `devDependencies` in frontend/package.json
- [ ] T002 Update dependency lockfile after plugin install in frontend/package-lock.json
- [ ] T003 [P] Ensure setup instructions include dependency install step in specs/003-webpack-path-aliases/quickstart.md

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Confirm shared alias foundations that all stories rely on.

**⚠️ CRITICAL**: No user story implementation should start before this phase is complete.

- [ ] T004 Confirm canonical alias source remains `"@/*": ["./src/*"]` in frontend/tsconfig.json
- [ ] T005 Confirm Jest alias mapper remains `"^@/(.*)$": "<rootDir>/src/$1"` in frontend/package.json
- [ ] T006 [P] Confirm lint CI gate continues running `npm run lint` in .github/workflows/ci.yml

**Checkpoint**: Tooling foundation is ready for story implementation.

---

## Phase 3: User Story 1 - Developer imports modules using path aliases (Priority: P1) 🎯 MVP

**Goal**: Preserve and validate stable `@/` alias usage for build + TypeScript + IDE flows.

**Independent Test**: A developer can import via `@/...` and run frontend build/type-check without module-resolution errors.

### Implementation for User Story 1

- [ ] T007 [US1] Ensure `baseUrl` and `@/*` path mapping are correctly set for alias resolution in frontend/tsconfig.json
- [ ] T008 [US1] Validate frontend build resolves alias imports used by frontend/src/app/page.tsx
- [ ] T009 [P] [US1] Document canonical alias policy (tsconfig as source of truth) in specs/003-webpack-path-aliases/quickstart.md

**Checkpoint**: User Story 1 is independently functional and verifiable.

---

## Phase 4: User Story 2 - ESLint flags relative imports that violate alias rules (Priority: P2)

**Goal**: Enforce lint errors for deep relative imports (`../../` and deeper) while allowing `./` and `../`.

**Independent Test**: Running lint on a file containing `../../` import reports an error from `no-relative-import-paths/no-relative-import-paths`.

### Implementation for User Story 2

- [ ] T010 [US2] Register `no-relative-import-paths` plugin in frontend/.eslintrc.json
- [ ] T011 [US2] Configure `no-relative-import-paths/no-relative-import-paths` rule options (`allowSameFolder`, `rootDir`, `prefix`, `allowedDepth`) in frontend/.eslintrc.json
- [ ] T012 [US2] Document lint-failure expectations and violation examples in specs/003-webpack-path-aliases/quickstart.md

**Checkpoint**: User Story 2 is independently functional and verifiable.

---

## Phase 5: User Story 3 - ESLint auto-fixes violating imports using `--fix` (Priority: P3)

**Goal**: Ensure auto-fix rewrites qualifying deep relative imports to `@/` alias imports.

**Independent Test**: Running `npm run lint:fix` rewrites a qualifying deep relative import to `@/...` and leaves non-qualifying imports unchanged.

### Implementation for User Story 3

- [ ] T013 [US3] Verify `lint:fix` script remains available for automated rewrites in frontend/package.json
- [ ] T014 [US3] Document before/after auto-fix import rewrite examples in specs/003-webpack-path-aliases/quickstart.md
- [ ] T015 [US3] Capture auto-fix verification notes for `../../` vs `../` behavior in specs/003-webpack-path-aliases/quickstart.md

**Checkpoint**: User Story 3 is independently functional and verifiable.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final consistency checks across all stories.

- [ ] T016 [P] Verify plan/spec/task consistency for alias policy and lint options in specs/003-webpack-path-aliases/plan.md
- [ ] T017 [P] Verify research/spec/task consistency for `allowedDepth: 1` and plugin choice in specs/003-webpack-path-aliases/research.md
- [ ] T018 Run quickstart validation flow and finalize command accuracy in specs/003-webpack-path-aliases/quickstart.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; start immediately.
- **Foundational (Phase 2)**: Depends on Setup; blocks all user stories.
- **User Story Phases (3-5)**: Depend on Foundational completion.
- **Polish (Phase 6)**: Depends on completion of all selected user stories.

### User Story Dependencies

- **US1 (P1)**: Starts after Phase 2; no dependency on other user stories.
- **US2 (P2)**: Starts after Phase 2; independent of US1.
- **US3 (P3)**: Starts after Phase 2; depends on US2 lint rule configuration being present.

### Within Each User Story

- Configure required files first.
- Validate story-specific behavior with existing commands.
- Update quickstart documentation for operational clarity.

### Parallel Opportunities

- Setup: T003 can run in parallel with T001/T002.
- Foundational: T006 can run in parallel with T004/T005.
- US1: T009 can run in parallel with T007/T008.
- Polish: T016 and T017 can run in parallel.

---

## Parallel Example: User Story 1

```bash
# Parallelizable US1 tasks:
Task: "Ensure baseUrl and @/* path mapping in frontend/tsconfig.json" (T007)
Task: "Document canonical alias policy in specs/003-webpack-path-aliases/quickstart.md" (T009)
```

---

## Parallel Example: User Story 2

```bash
# Configure lint rule, then document examples:
Task: "Register no-relative-import-paths plugin in frontend/.eslintrc.json" (T010)
Task: "Configure rule options in frontend/.eslintrc.json" (T011)
Task: "Document lint-failure expectations in specs/003-webpack-path-aliases/quickstart.md" (T012)
```

---

## Parallel Example: User Story 3

```bash
# Validate script and documentation tracks expected rewrite behavior:
Task: "Verify lint:fix script in frontend/package.json" (T013)
Task: "Document rewrite examples in specs/003-webpack-path-aliases/quickstart.md" (T014)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup).
2. Complete Phase 2 (Foundational).
3. Complete Phase 3 (US1).
4. Validate US1 independently via alias-based build resolution.

### Incremental Delivery

1. Deliver US1 (alias baseline validation).
2. Deliver US2 (lint error enforcement).
3. Deliver US3 (auto-fix behavior).
4. Run Phase 6 polish checks.

### Parallel Team Strategy

1. Team completes Setup + Foundational together.
2. After Phase 2:
   - Developer A: US1 tasks
   - Developer B: US2 tasks
   - Developer C: US3 tasks (after US2 config lands)
3. Rejoin for polish tasks.
