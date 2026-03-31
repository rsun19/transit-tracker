# Quickstart: Comprehensive Test Automation and CI Quality Gates

**Branch**: `002-test-automation-ci` | **Date**: 2026-03-30

This guide describes how to execute the new quality gates from repository root and how to mirror CI behavior locally.

## Prerequisites

- Node.js 20+
- npm 10+
- Docker Desktop (recommended for full-stack local runtime)

Install dependencies:

```bash
npm install
npm install --prefix backend
npm install --prefix frontend
```

## 1. Run Lint Gate (root)

```bash
npm run lint
```

Expected behavior:

- Lints backend and frontend
- Fails on warnings/errors

## 2. Run Unit Gate (root)

```bash
npm run test:unit
```

Expected behavior:

- Runs backend and frontend unit suites from root
- Reports coverage for each package
- Enforces backend >=85% lines and frontend >=80% lines

## 3. Run Integration Gate (root)

```bash
npm run test:integration
```

Expected behavior:

- Runs backend and cross-surface integration checks.
- Exits non-zero on any integration failure.

## 4. Run Contract Gate (root)

```bash
npm run test:contract
```

Expected behavior:

- Executes API/schema contract checks.
- Fails when contract drift is detected.

## 5. Run Accessibility Gate (root)

```bash
npm run test:a11y
```

Expected behavior:

- Runs automated accessibility checks (including existing jest-axe suites).
- Fails on new WCAG 2.1 AA violations.

## 6. Run Performance Gate (root)

```bash
npm run test:performance
```

Expected behavior:

- Measures defined performance budgets and compares against constitution thresholds.
- Fails when any threshold is exceeded.

## 7. Run Cypress e2e Headless (root)

```bash
npm run test:e2e
```

Expected behavior:

- Runs Cypress in non-interactive mode
- Executes all configured area groups
- Fails if any group has failures or zero discovered tests

Optional area-specific execution:

```bash
CYPRESS_GROUP=map npm run test:e2e
CYPRESS_GROUP=stops npm run test:e2e
CYPRESS_GROUP=routes npm run test:e2e
CYPRESS_GROUP=core-smoke npm run test:e2e
```

## 8. Run Cypress Interactive Mocked-Browser Mode (root)

Start app/mocks (one option):

```bash
npm run dev
```

In another terminal:

```bash
npm run test:e2e:open
```

Expected behavior:

- Opens Cypress browser runner
- Allows selecting and debugging specs interactively
- Uses the same grouped spec layout as CI

## 9. Run Full Test Entry Point (root)

```bash
npm test
```

Expected behavior:

- Executes project-defined full test flow from root (lint, unit, integration, contract, accessibility, performance, e2e policy)
- Returns non-zero if any delegated test command fails

Supplementary local script checks:

```bash
node --test tests/scripts/root-commands.spec.mjs
node --test tests/scripts/e2e-open-preflight.spec.mjs
```

## 10. CI Parity Checklist

Before opening a pull request, verify:

1. `npm run lint` passes
2. `npm run test:unit` passes and meets coverage targets
3. `npm run test:integration` passes
4. `npm run test:contract` passes
5. `npm run test:a11y` passes
6. `npm run test:performance` passes
7. `npm run test:e2e` passes all groups with non-zero discovered tests
8. Interactive mode (`npm run test:e2e:open`) is usable for debugging

## 11. Peer Review Gate Verification

Before merge, verify repository branch protection requires at least one non-author approval and all required CI checks are green.

## 12. SC-003 Contributor Timing Capture Template

Capture at least 10 contributor samples using local execution:

| Contributor | Date | Unit Gate (s) | Cypress Headless (s) | Interactive Preflight (pass/fail) | Notes |
| ----------- | ---- | ------------- | -------------------- | --------------------------------- | ----- |
|             |      |               |                      |                                   |       |
|             |      |               |                      |                                   |       |
|             |      |               |                      |                                   |       |
|             |      |               |                      |                                   |       |
|             |      |               |                      |                                   |       |
|             |      |               |                      |                                   |       |
|             |      |               |                      |                                   |       |
|             |      |               |                      |                                   |       |
|             |      |               |                      |                                   |       |
|             |      |               |                      |                                   |       |

Use this shell template for consistent timing capture:

```bash
time npm run test:unit
time npm run test:e2e
npm run test:e2e:open
```
