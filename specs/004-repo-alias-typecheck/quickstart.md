# Quickstart: Repository-Wide Alias Policy & Type Diagnostics Command

## Goal

Run one repository command to validate TypeScript diagnostics and alias behavior across backend and frontend.

## Prerequisites

1. Install dependencies:
   - `npm ci`
   - `npm ci --prefix backend`
   - `npm ci --prefix frontend`

## Run repository-wide type diagnostics

1. Execute:
   - `npm run typecheck`
2. Expected behavior:
   - Runs backend and frontend diagnostics.
   - Reports all discovered diagnostics.
   - Returns non-zero if any project fails.

## Validate alias diagnostics behavior

1. Run repository type diagnostics:
   - `npm run typecheck`
2. Confirm pass/fail is consistent locally and in CI.

## Failure interpretation

- If backend fails, resolve diagnostics in backend code/config first.
- If frontend fails, resolve diagnostics in frontend code/config first.
- Re-run `npm run typecheck` until all diagnostics pass.

## IDE diagnostics refresh guidance

After changing alias configuration:

1. Restart TypeScript language service in your editor.
2. Reload the workspace if stale diagnostics remain.
3. Re-run `npm run typecheck` to confirm CLI and IDE parity.
