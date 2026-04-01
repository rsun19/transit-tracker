# Research: Webpack Path Aliases & ESLint Enforcement

**Phase 0 output for**: `003-webpack-path-aliases`  
**Date**: 2026-03-31  
**All NEEDS CLARIFICATION items**: Resolved

---

## 1. Alias Resolution in Next.js 14

**Decision**: Use `tsconfig.json` `paths` as the canonical alias source; do not add a `webpack.resolve.alias` block to `next.config.mjs`.

**Rationale**: Next.js 14 reads `compilerOptions.paths` from `tsconfig.json` natively and passes them to the internal Webpack configuration automatically. Defining aliases in `next.config.mjs` would duplicate the configuration and create a second authoritative source that must be kept in sync.

**Discovery**: The `@/*` alias (`"@/*": ["./src/*"]`) is **already defined** in `frontend/tsconfig.json`. No build-config changes are required for this feature.

**Alternatives considered**:

- `next.config.mjs` `webpack.resolve.alias`: Rejected — duplicates tsconfig, breaks IDE typecheck unless mirrored.
- Separate `paths.js` file read by both tsconfig and next config: Rejected — adds indirection for a single alias; valuable only if managing 10+ aliases.

---

## 2. TypeScript Resolution

**Decision**: TypeScript consumes `tsconfig.json` `paths` natively. IDE type resolution and autocomplete work from the same definition with no extra tooling.

**Discovery**: `frontend/tsconfig.json` `baseUrl` is set to `.` (the `frontend/` directory), and `paths` uses `./src/*`. This is the correct configuration for Next.js with TypeScript.

**Alternatives considered**: None — TypeScript paths are the standard mechanism.

---

## 3. ESLint Enforcement Plugin

**Decision**: Use `eslint-plugin-no-relative-import-paths` v1.6.1 with the following configuration:

```json
"no-relative-import-paths/no-relative-import-paths": [
  "error",
  {
    "allowSameFolder": true,
    "rootDir": "src",
    "prefix": "@",
    "allowedDepth": 1
  }
]
```

**Rationale**:

- `allowedDepth: 1` — imports with a single `../` traversal are NOT flagged; `../../` and deeper ARE flagged. This matches FR-003.
- `allowSameFolder: true` — `./` imports are not flagged. This matches FR-004.
- `rootDir: "src"` — the auto-fix strips the `src/` prefix from the absolute path so rewrites land on `@/components/...` not `@/src/components/...`.
- `prefix: "@"` — the auto-fix prepends `@` to produce `@/components/...` matching the `@/*` alias.
- `"error"` (not `"warn"`) — combined with `--max-warnings 0` in the existing `lint` script this ensures CI fails on any violation.

**Plugin facts** (verified on npm, 2026-03-31):

- Version: 1.6.1
- Unpacked size: 8.69 KB
- Production dependencies: 0
- Weekly downloads: ~620 k
- License: ISC
- ESLint compatibility: works with ESLint 8 legacy config

**Alternatives considered**:

- `eslint-plugin-import` with `no-relative-packages` / `order` rules: More complex config, aimed at monorepo package boundaries rather than path alias enforcement. Overkill.
- `@typescript-eslint/consistent-type-imports`: Unrelated (type imports only).
- Custom rule: Unnecessary given the package exists and is purpose-built.

---

## 4. Jest Module Name Mapping

**Decision**: No changes required — already configured.

**Discovery**: `frontend/package.json` `jest.moduleNameMapper` already contains:

```json
"^@/(.*)$": "<rootDir>/src/$1"
```

This correctly resolves `@/` aliases in Jest 29 + ts-jest. SC-006 (at most two files) is already satisfied because this file requires no further edits.

**Alternatives considered**: None — existing configuration is correct.

---

## 5. Existing Violations Audit

**Decision**: No migration step is needed as part of this feature.

**Discovery**: A full grep across `frontend/src/**/*.{ts,tsx}` for patterns matching `(['"])(\.\./){2,}` found **zero matches**. No file in the current frontend source uses a deep relative import (2+ levels). The ESLint rule can be added at `"error"` severity without breaking the existing codebase.

**Implications**: `eslint --fix` migration phase (P3 story) is a no-op on the current codebase. Future code will be caught by the rule.

---

## 6. ESLint 8 Legacy Config Compatibility

**Decision**: Configure the plugin using the existing `.eslintrc.json` format (ESLint 8 legacy config). Do NOT migrate to flat config (`eslint.config.mjs`).

**Rationale**: The project uses ESLint 8 with `.eslintrc.json`. Migrating to flat config is a separate, larger concern. `eslint-plugin-no-relative-import-paths` v1.6.1 supports both formats; legacy config is the correct choice here.

**Configuration template**:

```json
{
  "plugins": ["no-relative-import-paths"],
  "rules": {
    "no-relative-import-paths/no-relative-import-paths": [
      "error",
      { "allowSameFolder": true, "rootDir": "src", "prefix": "@", "allowedDepth": 1 }
    ]
  }
}
```

---

## Resolution Summary

| NEEDS CLARIFICATION Item    | Resolution                                                   |
| --------------------------- | ------------------------------------------------------------ |
| Build mechanism for aliases | tsconfig.json `paths` — already in place, no changes needed  |
| ESLint enforcement plugin   | `eslint-plugin-no-relative-import-paths` v1.6.1              |
| Violation depth threshold   | `allowedDepth: 1` (flags `../../` and deeper only)           |
| Jest alias resolution       | Already configured in `package.json` `jest.moduleNameMapper` |
| Existing violations         | Zero — no migration work required                            |
| Config format               | ESLint 8 legacy `.eslintrc.json`                             |
