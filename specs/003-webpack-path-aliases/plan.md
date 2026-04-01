# Implementation Plan: Webpack Path Aliases & ESLint Enforcement

**Branch**: `003-webpack-path-aliases` | **Date**: 2026-03-31 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-webpack-path-aliases/spec.md`

## Summary

Add `eslint-plugin-no-relative-import-paths` to the frontend as a dev dependency and configure it in `.eslintrc.json` to flag any import that traverses two or more directory levels up (`../../` or deeper), while permitting same-folder (`./`) and single-parent (`../`) imports. The `@/*` alias and Jest `moduleNameMapper` are already configured in `tsconfig.json` and `package.json` respectively; this feature's scope is the ESLint enforcement layer only.

## Technical Context

**Language/Version**: TypeScript 5.3, Node.js 20  
**Primary Dependencies**: Next.js 14, ESLint 8 (legacy `.eslintrc.json` config), `eslint-plugin-no-relative-import-paths` 1.6.1 (new dev dep)  
**Storage**: N/A  
**Testing**: Jest 29 + ts-jest (no application logic to unit test; the lint rule validates itself at lint time)  
**Target Platform**: Developer workstation + CI (Ubuntu) — build toolchain only, not runtime  
**Project Type**: Web application (frontend tooling configuration)  
**Performance Goals**: N/A — not runtime code  
**Constraints**: ESLint 8 legacy config format required (`eslintrc.json`); `next/core-web-vitals` preset already extends `.eslintrc.json`; `--max-warnings 0` is enforced in `npm run lint`  
**Scale/Scope**: `frontend/` directory only; zero existing deep-relative violations found in `frontend/src`

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Gate                            | Principle        | Status        | Notes                                                                                                                                                                             |
| ------------------------------- | ---------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consistent style enforced in CI | I.3 Code Quality | ✅ PASS       | This feature strengthens the gate — adds the lint rule that prevents style drift in imports                                                                                       |
| Dependency discipline           | I.4 Code Quality | ✅ PASS       | `eslint-plugin-no-relative-import-paths` v1.6.1: 0 production dependencies, 8.69 KB unpacked, purpose-built for this exact problem. No existing in-repo capability performs this. |
| Test-first by default           | II.1 Testing     | ✅ PASS (n/a) | No application logic introduced; the ESLint rule itself is the verification mechanism. Manual smoke test: run `eslint --fix` on a synthetic violating file.                       |
| Coverage floor ≥ 80%            | II.2 Testing     | ✅ PASS (n/a) | No new source files with function/branch coverage. Existing coverage is unaffected.                                                                                               |
| UX Consistency                  | III              | N/A           | Tooling-only feature                                                                                                                                                              |
| Performance thresholds          | IV               | N/A           | Tooling-only feature                                                                                                                                                              |

**Constitution Check Result**: ALL applicable gates PASS. No violations to track.

## Project Structure

### Documentation (this feature)

```text
specs/003-webpack-path-aliases/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created by /speckit.plan)
```

_Note: No `contracts/` directory — this feature has no external interfaces (pure build tooling)._

### Source Code (repository root)

```text
frontend/
├── .eslintrc.json          # add: no-relative-import-paths plugin + rule
├── package.json            # add: eslint-plugin-no-relative-import-paths devDependency
├── tsconfig.json           # already has @/* paths (no changes needed)
└── src/                    # no source changes needed; zero existing violations
```

**Structure Decision**: Web application layout — frontend only. Backend is out of scope per spec assumptions.

## Complexity Tracking

> _No Constitution violations — section left empty._
