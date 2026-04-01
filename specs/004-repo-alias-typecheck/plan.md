# Implementation Plan: Repository-Wide Alias Policy & Type Diagnostics Command

**Branch**: `004-repo-alias-typecheck` | **Date**: 2026-04-01 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/004-repo-alias-typecheck/spec.md`

## Summary

Introduce a root repository command `npm run typecheck` that runs TypeScript diagnostics across backend and frontend, and enforce repository-wide alias policy validation in both projects. The feature standardizes local and CI type diagnostics behavior and adds a reproducible diagnostics validation task (including no-emit checks and controlled alias-resolution checks) to prevent regressions.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20  
**Primary Dependencies**: TypeScript CLI (`tsc`), Next.js 14 frontend, NestJS 10 backend, ESLint 8, `eslint-plugin-no-relative-import-paths`  
**Storage**: N/A (tooling/configuration feature)  
**Testing**: Existing automated CI gates plus new type diagnostics checks (`tsc --noEmit`) and alias-resolution validation tasks  
**Target Platform**: Local developer machines and GitHub Actions (Ubuntu)  
**Project Type**: Monorepo web application (backend + frontend + root orchestration scripts)  
**Performance Goals**: Repository-wide `npm run typecheck` completes in under 3 minutes on typical dev machines  
**Constraints**: Must use same command in local and CI; both backend and frontend in scope; report all project diagnostics before non-zero exit  
**Scale/Scope**: Root workspace plus `backend/` and `frontend/`; no TypeScript project deferred in v1

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Gate                                | Principle       | Status | Notes                                                                                  |
| ----------------------------------- | --------------- | ------ | -------------------------------------------------------------------------------------- |
| Consistent style and CI enforcement | I. Code Quality | PASS   | Feature standardizes diagnostics and alias validation across projects and CI.          |
| Dependency discipline               | I. Code Quality | PASS   | Any added lint plugin is purpose-specific and scoped to dev tooling.                   |
| Test-first by default               | II. Testing     | PASS   | Plan includes automated diagnostics validation tasks before implementation completion. |
| Coverage floor                      | II. Testing     | PASS   | No runtime business logic added; existing module coverage thresholds remain unchanged. |
| Accessibility/UX consistency        | III. UX         | N/A    | Tooling-only change; no UI behavior change.                                            |
| Performance requirements            | IV. Performance | PASS   | Explicit threshold in spec for typecheck runtime (<3 minutes).                         |

**Constitution Check Result**: PASS. No unjustified violations.

**Post-Design Re-Check**: PASS. Research and design artifacts preserve the same gate outcomes, with no new constitution violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/004-repo-alias-typecheck/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

_Note: `contracts/` is intentionally omitted; this feature does not introduce external API/interface contracts._

### Source Code (repository root)

```text
backend/
├── package.json          # add backend typecheck and alias-policy validation hooks
├── tsconfig.json         # keep/align backend alias mapping
└── src/

frontend/
├── package.json          # add/align frontend typecheck and alias-policy validation hooks
├── tsconfig.json         # keep/align frontend alias mapping
└── src/

package.json              # add root `npm run typecheck` orchestration command
.github/workflows/ci.yml  # enforce same root typecheck command in CI
scripts/
└── ci/                   # add diagnostics validation helper(s) if needed
```

**Structure Decision**: Web application monorepo (backend + frontend + root orchestration). Repository-wide policy enforced via root command and project-local configurations.

## Complexity Tracking

No constitution violations requiring exceptions.
