# Research: Repository-Wide Alias Policy & Type Diagnostics Command

## Decision 1: Canonical root command

- Decision: Use `npm run typecheck` in root `package.json` as the single entrypoint for diagnostics.
- Rationale: Matches clarification outcome and enforces local/CI parity.
- Alternatives considered:
  - Separate `typecheck:local` and `typecheck:ci`: Rejected due to drift risk.
  - Running project commands manually: Rejected due to inconsistent contributor behavior.

## Decision 2: Command behavior on failures

- Decision: Run diagnostics for both backend and frontend, report all errors, then return non-zero if any fail.
- Rationale: Provides complete feedback in one run and reduces repeated fix cycles.
- Alternatives considered:
  - Fail-fast on first project error: Rejected due to lower debugging efficiency.

## Decision 3: Project scope

- Decision: In-scope projects are backend and frontend in v1; no TypeScript project deferrals.
- Rationale: Explicitly required by clarified spec and eliminates ambiguity.
- Alternatives considered:
  - Frontend-first phased rollout: Rejected because repository-wide parity is required.

## Decision 4: Alias-policy enforcement mechanism

- Decision: Apply deep-relative-import validation in both backend and frontend with project-specific configuration values.
- Rationale: Keeps behavior consistent while allowing technical differences in tsconfig/module systems.
- Alternatives considered:
  - Documentation-only policy: Rejected due to weak enforcement.
  - Frontend-only lint enforcement: Rejected as out of scope with clarified requirements.

## Decision 5: Diagnostics validation task design

- Decision: Implement reproducible CLI validation that includes `tsc --noEmit` checks and controlled sample alias-resolution checks per project.
- Rationale: Satisfies FR-006/FR-007 and works without editor-specific tooling.
- Alternatives considered:
  - IDE plugin-based checks only: Rejected because not reproducible in CI.

## Decision 6: CI integration

- Decision: Update CI to execute the same root `npm run typecheck` command used locally.
- Rationale: Required by FR-009 and SC-005; avoids local/CI divergence.
- Alternatives considered:
  - Keep existing lint-only gate for type diagnostics: Rejected because it does not guarantee TS diagnostics parity.
