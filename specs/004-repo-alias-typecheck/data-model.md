# Data Model: Repository-Wide Alias Policy & Type Diagnostics Command

This feature is tooling/configuration focused and introduces no runtime domain entities.

## Entity: RepositoryAliasPolicy

- Purpose: Defines cross-project alias standards and enforcement expectations.
- Fields:
  - `scopeProjects`: string[] (v1: backend, frontend)
  - `deepRelativeThreshold`: string (e.g., `../../` and deeper)
  - `projectAliasConventions`: map<Project, AliasConvention>
  - `validationCommands`: string[]

## Entity: TypecheckCommand

- Purpose: Root command that orchestrates diagnostics across all in-scope projects.
- Fields:
  - `name`: string (`npm run typecheck`)
  - `projectCommands`: map<Project, string>
  - `reportMode`: enum (`aggregate`)
  - `exitBehavior`: enum (`nonzero-on-any-failure`)

## Entity: DiagnosticsValidationTask

- Purpose: Reproducible CLI workflow for alias diagnostics correctness.
- Fields:
  - `noEmitChecks`: map<Project, string>
  - `sampleAliasResolutionChecks`: map<Project, string>
  - `expectedOutcome`: enum (`pass` | `fail-with-diagnostics`)

## Relationship Notes

- `RepositoryAliasPolicy` governs how `TypecheckCommand` and `DiagnosticsValidationTask` are configured.
- `TypecheckCommand` executes project diagnostics; `DiagnosticsValidationTask` verifies alias behavior correctness and reproducibility.
