# Feature Specification: Repository-Wide Alias Policy & Type Diagnostics Command

**Feature Branch**: `004-repo-alias-typecheck`  
**Created**: 2026-04-01  
**Status**: Draft  
**Input**: User description: "Add a repository-wide path alias policy and validation, including a repo-wide type-check command and a task to validate IDE/TypeScript diagnostics (for example, tsc noEmit check and explicit alias-resolution check in a sample file). Also expand alias scope to the entire repository, not only frontend."

## Clarifications

### Session 2026-04-01

- Q: Should alias-policy enforcement apply to both backend and frontend? -> A: Yes. Alias-policy enforcement is in scope for both backend and frontend.
- Q: Should the root type-check command fail on first error or report all project diagnostics? -> A: Report all project diagnostics, then exit non-zero if any project fails.
- Q: What is the canonical repository-level command name? -> A: Use `npm run typecheck` at repository root.
- Q: Which projects are explicitly in scope for v1? -> A: Frontend and backend are both in scope; no TypeScript project is deferred in v1.
- Q: Should CI and local validation use different commands? -> A: No. CI and local checks use the same root `npm run typecheck` command for parity.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Run one command to verify repository-wide type health (Priority: P1)

A contributor can run one root-level command that validates TypeScript diagnostics across all repository projects so they can quickly detect typing regressions before opening a pull request.

**Why this priority**: A single shared command is the fastest way to reduce broken builds and inconsistent local validation across teams.

**Independent Test**: Execute the root type-check command and confirm it runs checks for each relevant project and exits non-zero when any project has type errors.

**Acceptance Scenarios**:

1. **Given** a clean repository state, **When** a contributor runs the root type-check command, **Then** diagnostics for all relevant projects are evaluated and the command exits successfully.
2. **Given** one project has a type error, **When** the same command runs, **Then** the command fails with a non-zero exit code and clearly indicates where the error occurred.

---

### User Story 2 - Enforce alias usage across repository projects (Priority: P2)

A contributor follows one repository-wide alias policy so imports remain readable and consistent instead of drifting into deep relative path patterns in different project folders.

**Why this priority**: Inconsistent import conventions across backend and frontend increase maintenance overhead and make refactors riskier.

**Independent Test**: Validate that each in-scope project has an explicit alias policy and validation path aligned to the same repository standard.

**Acceptance Scenarios**:

1. **Given** a project in the repository is in scope for TypeScript alias rules, **When** its configuration is reviewed, **Then** it has a documented alias convention and corresponding validation.
2. **Given** a contributor uses a deep relative import where an alias applies, **When** validation runs, **Then** the violation is reported according to repository policy.

---

### User Story 3 - Validate IDE alias diagnostics behavior (Priority: P3)

A contributor can verify that IDE and TypeScript diagnostics resolve alias imports correctly using a reproducible validation task, reducing editor-specific confusion.

**Why this priority**: Teams rely on editor diagnostics during development; mismatched alias diagnostics reduce confidence and waste debugging time.

**Independent Test**: Run the diagnostics validation task using a controlled sample alias import and confirm diagnostics are resolved without unresolved-module errors.

**Acceptance Scenarios**:

1. **Given** the diagnostics validation task and sample import are present, **When** the task is executed, **Then** alias imports are recognized as valid by TypeScript diagnostics.
2. **Given** alias configuration is intentionally broken, **When** diagnostics validation runs, **Then** unresolved import diagnostics are surfaced.

---

### Edge Cases

- If a project has TypeScript files but no alias mapping, that project is still in scope and must be configured before the feature is considered complete.
- Backend and frontend may use different alias prefixes, but both must satisfy the same repository policy and validation rules.
- Running the root command from a subdirectory must produce the same project diagnostics and exit behavior as running from repository root.
- Documentation must include deterministic steps for stale IDE diagnostics after alias configuration changes (restart TypeScript server / reload workspace).

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The repository MUST provide a root-level `npm run typecheck` command that validates TypeScript diagnostics for all in-scope projects.
- **FR-002**: The root-level `npm run typecheck` command MUST execute diagnostics for all in-scope projects, report all detected errors, and exit non-zero when any project fails.
- **FR-003**: The alias policy MUST apply repository-wide and, for v1, include both backend and frontend with no deferred TypeScript projects.
- **FR-004**: Each in-scope project MUST have an alias configuration and validation mechanism aligned with repository policy.
- **FR-005**: Validation MUST flag deep relative imports where a configured alias should be used in both backend and frontend.
- **FR-006**: The repository MUST include a reproducible diagnostics validation task that checks alias resolution behavior (including no-emit type-check execution and a controlled sample alias import scenario per in-scope project).
- **FR-007**: The diagnostics validation task MUST be runnable by contributors without editor-specific tooling dependencies.
- **FR-008**: Documentation MUST describe how to run the root type-check command, interpret failures, and verify alias diagnostics behavior.
- **FR-009**: CI type diagnostics validation MUST use the same root `npm run typecheck` command used by contributors locally.

### Key Entities _(include if feature involves data)_

- **Repository Alias Policy**: The cross-project rule set defining alias conventions, scope boundaries, and validation expectations.
- **Type Diagnostics Command**: The root-level command that runs TypeScript diagnostics across in-scope projects and returns pass/fail status.
- **Diagnostics Validation Task**: A reproducible workflow that confirms alias imports resolve correctly in TypeScript diagnostics using a controlled sample.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Contributors can run one root command and complete type diagnostics validation for all in-scope projects in under 3 minutes on a typical development machine.
- **SC-002**: Type-check regressions in any in-scope project are detected with a failing exit code in 100% of runs.
- **SC-003**: Alias-policy validation reports deep-relative import violations whenever a matching alias exists, with no known false negatives in controlled test cases.
- **SC-004**: Repository onboarding documentation enables a new contributor to execute the diagnostics validation task successfully on first attempt.
- **SC-005**: Alias diagnostics validation produces consistent pass/fail outcomes between local execution and CI checks using the same root `npm run typecheck` command.

## Assumptions

- The backend and frontend are both in scope for repository-wide alias policy in v1.
- Project-specific alias prefixes are acceptable as long as each project conforms to the shared repository policy and validation requirements.
- Existing project-level validation commands remain in place; the new root command orchestrates them rather than replacing all local scripts.
- Type diagnostics validation uses standard command-line tooling and does not require proprietary IDE integrations.
