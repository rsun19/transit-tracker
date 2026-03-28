<!--
## Sync Impact Report

**Version change**: (unversioned template) → 1.0.0
**Modified principles**: N/A (initial ratification from blank template)
**Added sections**:
- Core Principles (I–IV: Code Quality, Testing Standards, UX Consistency, Performance)
- Quality Gates
- Governance
**Removed sections**: None
**Templates requiring updates**:
- ✅ .specify/templates/plan-template.md — Constitution Check gates verified against new principles
- ✅ .specify/templates/spec-template.md — Success Criteria section aligns with performance/UX principles
- ✅ .specify/templates/tasks-template.md — Task phases align with test-first and quality gate principles
**Follow-up TODOs**: None — all placeholders resolved.
-->

# Transit Tracker Constitution

## Core Principles

### I. Code Quality (NON-NEGOTIABLE)

All production code MUST meet the following baseline standards before being considered shippable:

- **Readability first**: Code MUST be written for the next reader, not just for the compiler.
  Functions MUST have a single clear responsibility; files MUST stay under 400 lines.
- **No magic values**: All constants and configuration MUST be named and centralized;
  inline literals are forbidden except for boolean flags and zero/one comparisons.
- **Consistent style**: A project-wide linter and formatter MUST be configured and enforced
  in CI. No lint warnings are permitted to accumulate; new warnings MUST be resolved before
  merge.
- **Dependency discipline**: Third-party dependencies MUST be explicitly justified. Adding a
  dependency that duplicates existing stdlib or in-repo capability requires documented
  rationale.

**Rationale**: Transit data is time-sensitive and operationally critical. Unclear or
inconsistent code directly increases the risk of silent failures in route, arrival, and
alert calculations.

### II. Testing Standards (NON-NEGOTIABLE)

- **Test-first by default**: For any new feature or bug fix, tests MUST be written and
  reviewed before implementation begins. The Red-Green-Refactor cycle is strictly enforced.
- **Coverage floor**: Unit test coverage MUST remain at or above **80%** for all modules.
  Coverage regressions MUST be resolved before merge; exemptions require explicit annotation
  and reviewer sign-off.
- **Test categories required**:
  - *Unit*: Pure logic, data transformation, and parsing functions.
  - *Integration*: Feed ingestion pipelines, GTFS/GTFS-RT processing, and data-layer
    interactions.
  - *Contract*: API response shapes and external feed schemas MUST have contract tests that
    run on every CI build.
- **No skipped tests without tracking**: Skipped or xfail tests MUST reference an open issue
  and be re-evaluated each sprint.
- **Flaky tests are defects**: A test that fails intermittently MUST be treated with the same
  urgency as a production bug.

**Rationale**: Incorrect transit data (wrong arrival times, dropped routes, stale alerts)
erodes rider trust immediately. Rigorous testing is the primary defence.

### III. User Experience Consistency

- **Design token adherence**: All UI components MUST consume shared design tokens (colors,
  spacing, typography). Hard-coded style values are forbidden.
- **Uniform interaction patterns**: Identical user actions (e.g., selecting a route, refreshing
  data) MUST behave identically across all surfaces (web, mobile, widget). Divergence MUST
  be documented as an intentional platform accommodation, not left implicit.
- **Accessibility baseline**: All UI MUST meet WCAG 2.1 AA. Automated accessibility checks
  MUST run in CI; failures are blocking.
- **Error visibility**: Every error state visible to the user MUST include a human-readable
  message and a suggested action. Generic "Something went wrong" messages are not acceptable.
- **Loading and empty states**: Every data-driven view MUST define an explicit loading state
  and an empty/no-results state; these MUST be included in acceptance criteria for each
  feature.

**Rationale**: Riders rely on accurate, legible, and consistent information to make real-time
travel decisions. Inconsistent UX breaks trust and reduces utility.

### IV. Performance Requirements

The following thresholds are non-negotiable; violations block release:

| Metric | Threshold |
|---|---|
| Initial page / screen load (p95, cold) | ≤ 3 s on a 4G connection |
| Subsequent navigation (p95) | ≤ 1 s |
| Real-time data refresh latency (end-to-end) | ≤ 5 s from feed update |
| API response time (p95, server-side) | ≤ 200 ms |
| Client bundle size (gzipped, initial chunk) | ≤ 150 KB |

- Performance MUST be measured against these thresholds in CI for every release candidate
  using representative fixture data.
- Regressions that breach any threshold MUST be resolved or explicitly risk-accepted by the
  project owner before shipping.
- Performance budgets MUST be revisited at each MAJOR version bump and updated to reflect
  evolving platform capabilities.

**Rationale**: Transit information is perishable. A slow app delivers stale data, which is
equivalent to wrong data from a rider's perspective.

## Quality Gates

Every pull request MUST pass all of the following gates before merge:

1. **Lint & format**: Zero new lint warnings; formatter reports no diff.
2. **Unit tests**: All pass; coverage at or above 80% for changed modules.
3. **Integration tests**: All pass against a local fixture feed.
4. **Contract tests**: All pass; no schema drift detected.
5. **Accessibility scan**: Zero new WCAG 2.1 AA violations.
6. **Performance check**: No metric regresses beyond its defined threshold.
7. **Peer review**: At least one approval from a team member not the author.

Gates 1–6 MUST be automated in CI. Gate 7 is enforced via branch protection rules.

## Governance

- This constitution supersedes all other practices, style guides, and verbal agreements.
  When conflict arises, the constitution is the authority.
- **Amendments** require: a written proposal describing the change and rationale, review by
  all active contributors, a version bump per the semantic versioning policy below, and an
  update to `LAST_AMENDED_DATE`.
- **Versioning policy**:
  - MAJOR: Removal or redefinition of a principle; backward-incompatible governance change.
  - MINOR: New principle or section added; material expansion of existing guidance.
  - PATCH: Clarifications, wording improvements, typo fixes, threshold adjustments within
    the same order of magnitude.
- **Compliance review**: Adherence to this constitution MUST be verified in every PR review.
  The "Constitution Check" gate in `plan.md` MUST list each active principle and confirm
  compliance or document a justified exception.
- Complexity that violates a principle MUST be recorded in the `plan.md` Complexity Tracking
  table with a justification before work begins.

**Version**: 1.0.0 | **Ratified**: 2026-03-28 | **Last Amended**: 2026-03-28
