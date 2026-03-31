# Data Model: Comprehensive Test Automation and CI Quality Gates

**Branch**: `002-test-automation-ci` | **Date**: 2026-03-30  
**Source**: spec.md functional requirements and clarifications

## Overview

This feature models test automation as operational entities that can be validated locally and in CI. These entities are conceptual/domain models for planning and implementation and are not persisted in application runtime storage.

## Entities

### 1. QualityGateJob

Represents a top-level CI validation gate.

| Field              | Type                                                                                            | Description                                 | Validation                         |
| ------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------- |
| `name`             | enum(`lint-format`,`unit`,`integration`,`contract`,`accessibility`,`performance`,`peer-review`) | Gate identity                               | Required, unique within workflow   |
| `triggerEvents`    | set(`pull_request`,`push_main`)                                                                 | Events that execute the gate                | Must include both events           |
| `status`           | enum(`pending`,`running`,`passed`,`failed`,`cancelled`)                                         | Runtime outcome                             | Derived from CI job result         |
| `durationSeconds`  | integer                                                                                         | Execution time for reporting                | Must be >= 0                       |
| `requiredForMerge` | boolean                                                                                         | Branch protection or repository policy flag | Must be true for all defined gates |
| `failureSummary`   | string                                                                                          | Human-readable failure context              | Required when `status=failed`      |

### 2. BrowserTestGroup

Represents one Cypress area partition.

| Field             | Type                                        | Description                       | Validation                            |
| ----------------- | ------------------------------------------- | --------------------------------- | ------------------------------------- |
| `groupName`       | enum(`map`,`stops`,`routes`,`core-smoke`)   | Functional partition name         | Required, fixed allowed values        |
| `specPattern`     | string                                      | File glob for this partition      | Required, must map to group namespace |
| `mode`            | enum(`headless`,`interactive`)              | Execution mode                    | Required                              |
| `testsDiscovered` | integer                                     | Number of matched specs/tests     | Must be >= 0                          |
| `status`          | enum(`pending`,`running`,`passed`,`failed`) | Group result                      | Required                              |
| `zeroTestPolicy`  | enum(`fail`)                                | Behavior when `testsDiscovered=0` | Must be `fail`                        |
| `failureReason`   | string                                      | Root cause detail on failure      | Required when failed                  |

### 3. IntegrationSuite

Represents backend/system integration validation units that run as a dedicated gate.

| Field            | Type                                        | Description                  | Validation           |
| ---------------- | ------------------------------------------- | ---------------------------- | -------------------- |
| `suiteName`      | string                                      | Integration suite identifier | Required, unique     |
| `runner`         | enum(`jest-e2e`,`custom-script`)            | Execution harness            | Required             |
| `target`         | enum(`backend`,`full-stack`)                | Scope under test             | Required             |
| `status`         | enum(`pending`,`running`,`passed`,`failed`) | Execution result             | Required             |
| `failureSummary` | string                                      | Failure diagnostics          | Required when failed |

### 4. ContractValidation

Represents API/schema contract checks as a merge-blocking gate.

| Field             | Type                                        | Description                     | Validation            |
| ----------------- | ------------------------------------------- | ------------------------------- | --------------------- |
| `contractName`    | string                                      | Contract artifact identifier    | Required              |
| `contractType`    | enum(`api-shape`,`schema`)                  | Contract category               | Required              |
| `baselineVersion` | string                                      | Reference contract version/hash | Required              |
| `driftDetected`   | boolean                                     | Drift check outcome             | Must be false to pass |
| `status`          | enum(`pending`,`running`,`passed`,`failed`) | Contract gate result            | Required              |

### 5. AccessibilityScan

Represents accessibility validation outcomes in CI.

| Field           | Type                                         | Description                    | Validation        |
| --------------- | -------------------------------------------- | ------------------------------ | ----------------- |
| `scope`         | enum(`frontend-components`,`critical-flows`) | Scan scope                     | Required          |
| `standard`      | enum(`WCAG-2.1-AA`)                          | Compliance target              | Required          |
| `violations`    | integer                                      | Violation count                | Must be >= 0      |
| `newViolations` | integer                                      | Net new violations vs baseline | Must be 0 to pass |
| `status`        | enum(`pending`,`running`,`passed`,`failed`)  | Gate result                    | Required          |

### 6. PerformanceBudgetCheck

Represents threshold and regression validation for constitution performance budgets.

| Field            | Type                                                                                        | Description            | Validation                    |
| ---------------- | ------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------- |
| `metricName`     | enum(`initial-load-p95`,`navigation-p95`,`refresh-latency`,`api-p95`,`initial-bundle-gzip`) | Budget metric          | Required                      |
| `measuredValue`  | number                                                                                      | Observed metric value  | Required                      |
| `thresholdValue` | number                                                                                      | Constitution threshold | Required                      |
| `unit`           | enum(`seconds`,`milliseconds`,`kilobytes`)                                                  | Measurement unit       | Required                      |
| `status`         | enum(`pending`,`running`,`passed`,`failed`)                                                 | Budget result          | Pass only if within threshold |

### 7. PeerReviewRequirement

Represents repository policy compliance for mandatory non-author approval.

| Field              | Type                              | Description                   | Validation                                  |
| ------------------ | --------------------------------- | ----------------------------- | ------------------------------------------- |
| `minimumApprovals` | integer                           | Required non-author approvals | Must be >= 1                                |
| `actualApprovals`  | integer                           | Current approval count        | Must be >= 0                                |
| `enforcedBy`       | enum(`branch-protection`)         | Enforcement mechanism         | Required                                    |
| `status`           | enum(`pending`,`passed`,`failed`) | Gate outcome                  | `passed` only when approvals satisfy policy |

### 8. RootTestCommand

Represents a root `package.json` script contract for local and CI execution.

| Field            | Type                                                                                                                           | Description                            | Validation                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------- |
| `commandName`    | string                                                                                                                         | Script key in root package             | Required, unique                       |
| `purpose`        | enum(`lint-format`,`unit`,`integration`,`contract`,`accessibility`,`performance`,`e2e-headless`,`e2e-interactive`,`all-tests`) | Intended usage                         | Required                               |
| `delegatesTo`    | string[]                                                                                                                       | Underlying workspace commands/services | Must include at least one target       |
| `mode`           | enum(`ci`,`local`,`both`)                                                                                                      | Supported execution context            | Required                               |
| `exitCodePolicy` | enum(`nonzero-on-any-failure`)                                                                                                 | Failure semantics                      | Must be nonzero on any failing subtask |

## Relationships

```text
QualityGateJob (name=integration)
  └── has many BrowserTestGroup (map, stops, routes, core-smoke)

QualityGateJob (name=contract)
  └── has many ContractValidation

QualityGateJob (name=accessibility)
  └── has many AccessibilityScan

QualityGateJob (name=performance)
  └── has many PerformanceBudgetCheck

QualityGateJob (name=peer-review)
  └── has one PeerReviewRequirement

IntegrationSuite
  └── has many BrowserTestGroup (map, stops, routes, core-smoke)

RootTestCommand
  ├── can trigger QualityGateJob-equivalent behavior locally for gates 1-6
  └── can invoke BrowserTestGroup execution in one or multiple modes
```

## State Transitions

### QualityGateJob Lifecycle

```text
pending -> running -> passed
                 -> failed
                 -> cancelled
```

### BrowserTestGroup Lifecycle

```text
pending -> running -> passed
                 -> failed (includes zero-test failure)
```

### RootTestCommand Lifecycle

```text
invoked -> delegates executing -> success (exit 0)
                            -> failure (non-zero exit)
```

## Derived Metrics

| Metric                      | Formula                                                       | Purpose                            |
| --------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| `cypressWallClockSeconds`   | max(durationSeconds of all BrowserTestGroup)                  | Overall CI Cypress wall-clock time |
| `cypressParallelEfficiency` | sum(group durations) / wall clock                             | Detect parallelism effectiveness   |
| `coverageCompliance`        | backendCoverage>=85 AND frontendCoverage>=80 AND noRegression | Unit comprehensiveness gate        |
| `performanceCompliance`     | all performance metrics <= constitution thresholds            | Performance gate policy            |
| `peerReviewCompliance`      | actualApprovals >= minimumApprovals                           | Peer-review gate policy            |
| `mergeReadiness`            | all required QualityGateJob status = passed                   | PR gate policy                     |
