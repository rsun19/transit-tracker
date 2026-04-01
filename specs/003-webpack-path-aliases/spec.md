# Feature Specification: Webpack Path Aliases & ESLint Enforcement

**Feature Branch**: `003-webpack-path-aliases`
**Created**: 2026-03-31
**Status**: Draft
**Input**: User description: "Implement Webpack's resolve.alias configuration option to create aliases to simplify module imports by mapping a shortcut string to an absolute file path. This eliminates the need for complex relative paths (e.g., ../../../components/button) and improves code readability and maintainability. There should also be an eslint rule to flag offenders and to fix it."

## Clarifications

### Session 2026-03-31

- Q: Should this feature add Webpack `resolve.alias` to `next.config.mjs`, or treat the existing `tsconfig.json` `paths` as the canonical alias source? → A: Use `tsconfig.json` `paths` as the only canonical alias source; no `next.config.mjs` changes needed. Next.js natively reads tsconfig paths for both build-time resolution and TypeScript.
- Q: Which ESLint plugin/rule should enforce the import alias policy? → A: Use `eslint-plugin-no-relative-import-paths` — purpose-built for this use case, provides a fixable rule, and supports a configurable depth allowance.
- Q: Should `../` (one level up) also be flagged, or only `../../` and deeper? → A: Only `../../` and deeper (2+ levels). Single-parent traversals (`../`) remain permitted as they are common for sibling-folder imports and are not materially harmed by path fragility.
- Q: Is running `eslint --fix` to migrate all existing violations a required deliverable of this feature? → A: No — this feature's deliverable is the tooling configuration only. Migrating existing violations is a follow-on step that can be done separately once tooling is in place.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Developer imports modules using path aliases (Priority: P1)

A developer writing new frontend code can use short alias paths (e.g., `@/components/Button`) instead of navigating deep relative paths that change with file location (e.g., `../../../components/Button`). The `@/*` alias is defined once in `tsconfig.json` and Next.js resolves it natively at build time; TypeScript and the IDE use the same definition for type checking and autocomplete.

**Why this priority**: Core feature value — aliases only deliver benefit once imports actually resolve. Everything else depends on this working first.

**Independent Test**: Create a new frontend component that imports using an alias path, run the dev build or type-check, and confirm no resolution errors appear. Delivers value immediately by allowing cleaner code.

**Acceptance Scenarios**:

1. **Given** the frontend project has aliases configured, **When** a developer writes `import Button from '@/components/ui/Button'`, **Then** the import resolves correctly and the application builds without errors.
2. **Given** an alias is defined for a top-level directory, **When** the importing file moves to a different folder, **Then** the import path remains the same and requires no update.
3. **Given** a developer opens the project in an IDE with TypeScript support, **When** they use an alias import, **Then** the IDE provides autocomplete and type information without showing an unresolved-module error.

---

### User Story 2 - ESLint flags relative imports that violate alias rules (Priority: P2)

A developer runs the linter (locally or in CI) and receives an error for any import that uses a deep relative path when a configured alias would apply. The error message identifies the import and the preferred alias form.

**Why this priority**: Enforcement prevents new violations from accumulating after aliases are introduced; without it, the alias configuration has no teeth.

**Independent Test**: Run `npm run lint` in the frontend directory against a file that contains `import X from '../../components/Button'`. Confirm a lint error is reported. Delivers standalone value as a code-quality gate.

**Acceptance Scenarios**:

1. **Given** a file imports using a path that traverses two or more directory levels up (e.g., `../../`), **When** the linter runs, **Then** it reports an error identifying the import and the preferred alias.
2. **Given** a file imports from the same directory (e.g., `./utils`), **When** the linter runs, **Then** no error is reported (same-directory relative imports are allowed).
3. **Given** CI runs the lint check on a pull request, **When** a file contains a violating relative import, **Then** the CI job fails and blocks the merge.

---

### User Story 3 - ESLint auto-fixes violating imports using `--fix` (Priority: P3)

A developer or automated process runs `eslint --fix` and all qualifying relative imports are automatically rewritten to use the correct alias. No manual search-and-replace is required.

**Why this priority**: Reduces migration effort for existing code and speeds up onboarding; lower priority because reporting (P2) already provides the quality gate.

**Independent Test**: Run `eslint --fix` on a file with a deep relative import. Open the file and confirm the import now uses the alias form. CI lint check passes afterward.

**Acceptance Scenarios**:

1. **Given** a file contains `import X from '../../../components/ui/Button'`, **When** `eslint --fix` runs, **Then** the import is rewritten to `import X from '@/components/ui/Button'` (or the applicable alias).
2. **Given** multiple files contain violating imports, **When** `eslint --fix` runs across the project, **Then** all qualifying imports are rewritten and the project still builds successfully.
3. **Given** an import path does not match any configured alias prefix, **When** `eslint --fix` runs, **Then** the import is left unchanged (no partial or incorrect rewrites).

---

### Edge Cases

- What happens when a relative path and an alias both resolve to the same file — which takes precedence in builds and the linter?
- How does the system handle a path that partially matches an alias prefix (e.g., alias is `@/components` but import targets `@/components-v2`)?
- What happens when a developer imports a `node_modules` package whose name begins with `@` (e.g., `@mui/material`) — does the lint rule incorrectly flag it?
- How does the configuration behave in test environments (Jest) where Webpack is not involved?

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The `@/*` alias MUST be defined in `tsconfig.json` `paths` as the canonical source; Next.js reads this natively for build-time and TypeScript resolution. No duplicate alias definition in `next.config.mjs` is required.
- **FR-002**: TypeScript MUST recognise all defined aliases so that IDE tooling provides accurate type checking and autocompletion without errors.
- **FR-003**: The linter MUST report an error for any import that uses two or more levels of relative traversal (`../../` or deeper) when a matching alias exists. Imports using a single parent traversal (`../`) are permitted.
- **FR-004**: Same-directory relative imports (`./`) MUST NOT trigger a lint error.
- **FR-005**: The lint rule MUST provide an auto-fix that rewrites violating imports to use the correct alias form.
- **FR-006**: The ESLint alias-enforcement rule MUST be implemented using `eslint-plugin-no-relative-import-paths`, configured with the project's alias map.
- **FR-007**: The `npm run lint` script MUST exit with a non-zero code when any alias-violation error is present, so CI catches regressions.
- **FR-008**: The Jest `moduleNameMapper` configuration MUST mirror the `tsconfig.json` `paths` definitions so aliases resolve correctly when running unit tests.

### Key Entities

- **Alias Map**: A named mapping from a short prefix string to an absolute directory path (e.g., `@/` → `frontend/src`). Multiple aliases may be defined.
- **Violating Import**: Any import statement that uses two or more `../` traversals when a configured alias covers the target path.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: All existing and new imports using alias prefixes resolve correctly — zero build errors after the alias configuration is applied.
- **SC-002**: The linter reports an error for 100% of imports with two or more levels of relative traversal that map to a configured alias, with no false negatives.
- **SC-003**: Running `eslint --fix` rewrites all qualifying violating imports in the project with no remaining lint errors and no broken builds afterward.
- **SC-004**: Developers experience zero IDE type errors for alias imports in TypeScript-aware editors.
- **SC-005**: The CI lint job fails within the normal job runtime when a pull request introduces a violating import, blocking the merge without manual review intervention.
- **SC-006**: Adding a new alias requires changes to at most two files — `tsconfig.json` (consumed by build, TypeScript, and linter) and `jest.config.*` (module name mapper). No other files need updating.

## Assumptions

- Path aliases apply to the frontend (Next.js) codebase; the backend (NestJS) is out of scope for this feature.
- The `@/*` alias (mapping to `frontend/src`) is already defined in `tsconfig.json`; this feature validates, documents, and enforces its use — it does not introduce a new alias from scratch.
- The `eslint-plugin-no-relative-import-paths` package will be added as a dev dependency in `frontend/package.json`.
- Single-parent traversals (`../`) are intentionally permitted; only imports with two or more `../` segments trigger an error when an alias covers the target.
- Same-directory relative imports (`./file`) are intentionally excluded from the lint rule as they are idiomatic and do not suffer from path fragility.
- Migrating existing deep relative imports in the codebase is out of scope for this feature; it is a follow-on task.
- Jest is the unit test runner (jest 29 + ts-jest); its `moduleNameMapper` must be updated to mirror the tsconfig `paths`.
- Scoped `node_modules` imports (e.g., `@mui/material`) are NOT flagged by the lint rule — the rule targets project-internal paths only.
