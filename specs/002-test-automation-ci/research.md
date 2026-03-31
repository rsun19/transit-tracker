# Research: Comprehensive Test Automation and CI Quality Gates

**Branch**: `002-test-automation-ci` | **Date**: 2026-03-30  
**Status**: Complete

## R1: Defining "Comprehensive" Unit Coverage

**Decision**: Use measurable line coverage thresholds of backend 85% and frontend 80%, and fail CI on any coverage regression relative to main.

**Rationale**: The feature requires objective quality gates, and numeric thresholds prevent subjective interpretation. A stricter backend threshold reflects service-critical transit logic while maintaining a realistic frontend target aligned with current tooling and test architecture.

**Alternatives considered**:

- No numeric threshold with reviewer judgment only: rejected due to inconsistent enforcement.
- Uniform 90% threshold for backend and frontend: rejected as high risk for delivery friction and unstable gates.
- Changed-files-only threshold: rejected because uncovered legacy-critical logic could still regress.

## R2: Parallelizing Cypress by Functional Area

**Decision**: Partition Cypress suites into four fixed groups: `map`, `stops`, `routes`, and `core-smoke`, and run these groups in parallel as CI matrix entries.

**Rationale**: Area-based groups map directly to product surfaces and make failures easier to triage. Fixed groups are stable over time and avoid dynamic shard imbalance complexity.

**Alternatives considered**:

- Single serial Cypress job: rejected due to slow feedback.
- Dynamic timing-based test sharding: rejected for added infrastructure complexity and maintenance overhead.
- Split by file count only: rejected because it weakens domain-level failure ownership.

## R3: CI Job Topology and Merge Gating

**Decision**: Implement separate CI jobs for `lint`, `unit`, and `cypress` (matrix) on pull requests and pushes to main. Merge requires all jobs to pass.

**Rationale**: Independent jobs improve observability and isolate failure causes. Matrix-based Cypress maintains single workflow ergonomics while preserving per-area visibility.

**Alternatives considered**:

- Monolithic CI job: rejected due to reduced observability and slower reruns.
- Separate workflow files per gate: rejected to avoid duplicated setup logic.
- Non-blocking Cypress job: rejected because end-to-end regressions must block merge.

## R4: Root-Level Test Command Orchestration

**Decision**: Define root `package.json` scripts that delegate to backend/frontend unit commands and centralized Cypress commands from repository root.

**Rationale**: The requirement calls for root-only ergonomics. Root scripts reduce onboarding friction and make CI/local parity clearer.

**Alternatives considered**:

- Require developers to run per-package commands manually: rejected due to inconsistency and user request mismatch.
- Use only Makefile/task runner without package scripts: rejected because repository already standardizes command entry via npm scripts.

## R5: Headless and Interactive Mocked-Browser e2e Modes

**Decision**: Support two explicit e2e modes: headless (`cypress run`) and interactive mocked-browser mode (`app + mocks up`, then `cypress open`).

**Rationale**: Headless mode is reliable for CI; interactive mode is necessary for local debugging and requested explicitly. Explicit mode naming removes ambiguity.

**Alternatives considered**:

- Headless only: rejected because it prevents visual debugging workflows.
- Interactive only: rejected because it is unsuitable for CI automation.
- Browserstack/remote grid dependency: rejected as unnecessary external complexity for current scope.

## R6: Empty Group Handling in CI

**Decision**: Treat zero discovered tests in any Cypress area group as a hard CI failure with explicit diagnostics.

**Rationale**: Empty groups can mask accidental path mismatches and silently reduce coverage. Failing fast preserves trust in the split architecture.

**Alternatives considered**:

- Allow pass on zero tests: rejected due to silent coverage gaps.
- Auto-merge empty groups into another group: rejected due to non-deterministic behavior and reduced visibility.

## R7: Mandatory Constitution Quality Gates as Implementation Scope

**Decision**: Treat all seven constitution quality gates as in-scope delivery requirements for this feature implementation: lint/format, unit, integration, contract, accessibility, performance, and peer review.

**Rationale**: The constitution declares these gates mandatory for merge; limiting implementation to a subset would create governance drift and incomplete release safety coverage.

**Alternatives considered**:

- Keep integration/contract/accessibility/performance/peer review out of scope for this feature: rejected because it leaves constitutional gates undocumented or unimplemented.
- Mark remaining gates as future work exceptions: rejected due to explicit requirement for full PASS constitution posture.

## R8: Integration and Contract Gate Execution Strategy

**Decision**: Use root-level orchestration to run backend integration suites and API/schema contract validations as dedicated CI jobs with independent status reporting and blocking semantics.

**Rationale**: Dedicated jobs improve failure triage and align with the existing requirement for independently visible quality outcomes.

**Alternatives considered**:

- Bundle integration/contract checks into unit job: rejected due to reduced observability and rerun inefficiency.
- Run integration/contract only on scheduled builds: rejected because constitution requires PR merge gating.

## R9: Accessibility and Performance Gate Strategy

**Decision**: Implement accessibility scans (existing jest-axe and expanded checks) and performance budget verification as explicit CI gates that fail on new violations or threshold breaches.

**Rationale**: Accessibility and performance are constitution-level non-negotiables; explicit gates prevent regressions from being missed during feature delivery.

**Alternatives considered**:

- Keep accessibility/performance as non-blocking informational reports: rejected due to constitution conflict.
- Manual spot checks only: rejected because results would be inconsistent and not enforceable.

## R10: Peer Review Enforcement Mechanism

**Decision**: Enforce peer review gate through repository branch protection requiring at least one non-author approval, and capture this as an implementation responsibility in plan/contracts.

**Rationale**: Peer review is mandatory but is best enforced at repository policy level rather than ad hoc process.

**Alternatives considered**:

- Rely on contributor convention for approvals: rejected as non-enforceable.
- Add custom CI check to mimic approvals: rejected because native branch protection is simpler and authoritative.

## R11: Cypress Parallel Timing Capture (Post-Implementation)

**Decision**: Record wall-clock timing per Cypress area job and compare against a serial local baseline to validate split-group throughput improvements.

**Captured metrics template**:

| Run Type                                   | map (s) | stops (s) | routes (s) | core-smoke (s) | Wall Clock (s) |
| ------------------------------------------ | ------- | --------- | ---------- | -------------- | -------------- |
| Serial local baseline (`npm run test:e2e`) | TBD     | TBD       | TBD        | TBD            | TBD            |
| CI parallel matrix aggregate               | TBD     | TBD       | TBD        | TBD            | TBD            |

**Improvement formula**:

`improvement_percent = (serial_wall_clock - parallel_wall_clock) / serial_wall_clock * 100`

**Status**: Awaiting first CI run on the new workflow to populate final values.

## R12: SC-003 Contributor Sample Evidence

**Decision**: Use a minimum sample of 10 contributors executing root commands from quickstart, with captured timing and blockers.

**Evidence table**:

| Contributor | Date | Unit Gate (s) | Cypress Headless (s) | Interactive Preflight | Result  |
| ----------- | ---- | ------------- | -------------------- | --------------------- | ------- |
| TBD         | TBD  | TBD           | TBD                  | TBD                   | Pending |
| TBD         | TBD  | TBD           | TBD                  | TBD                   | Pending |
| TBD         | TBD  | TBD           | TBD                  | TBD                   | Pending |
| TBD         | TBD  | TBD           | TBD                  | TBD                   | Pending |
| TBD         | TBD  | TBD           | TBD                  | TBD                   | Pending |
| TBD         | TBD  | TBD           | TBD                  | TBD                   | Pending |
| TBD         | TBD  | TBD           | TBD                  | TBD                   | Pending |
| TBD         | TBD  | TBD           | TBD                  | TBD                   | Pending |
| TBD         | TBD  | TBD           | TBD                  | TBD                   | Pending |
| TBD         | TBD  | TBD           | TBD                  | TBD                   | Pending |

**Status**: Blocked on contributor sampling outside this implementation session.
