# Data Model: Webpack Path Aliases & ESLint Enforcement

**Phase 1 output for**: `003-webpack-path-aliases`  
**Date**: 2026-03-31

---

> This feature is pure build tooling — it has no runtime data models, no database entities, and no API request/response schemas. The "entities" described below are configuration concepts that exist as static entries in config files.

---

## Entities

### Alias Entry

An entry in the TypeScript `paths` map that declares a short prefix and its resolved directory.

| Field     | Type     | Description                                                           | Example       |
| --------- | -------- | --------------------------------------------------------------------- | ------------- |
| `prefix`  | string   | The import alias prefix, including trailing wildcard                  | `@/*`         |
| `targets` | string[] | One or more directory paths the prefix maps to, relative to `baseUrl` | `["./src/*"]` |

**Canonical location**: `frontend/tsconfig.json` → `compilerOptions.paths`  
**Consumed by**: Next.js build (natively), TypeScript compiler / IDE, ESLint (via plugin options), Jest (via `moduleNameMapper` mirror)

**Current value**:

```json
"paths": {
  "@/*": ["./src/*"]
}
```

---

### ESLint Rule Configuration

The options object that governs what the `no-relative-import-paths` rule flags and how auto-fix rewrites imports.

| Field             | Type    | Description                                                                   | Value for this project |
| ----------------- | ------- | ----------------------------------------------------------------------------- | ---------------------- |
| `allowSameFolder` | boolean | Permits `./` (same-folder) imports                                            | `true`                 |
| `rootDir`         | string  | Root directory stripped from auto-fixed absolute path                         | `"src"`                |
| `prefix`          | string  | Prefix prepended during auto-fix to produce alias-style path                  | `"@"`                  |
| `allowedDepth`    | number  | Maximum allowed `../` traversal depth (inclusive); deeper imports are flagged | `1`                    |

**Canonical location**: `frontend/.eslintrc.json` → `rules`

**Resulting behaviour**:

| Import pattern            | Traversal depth | Flagged?                      |
| ------------------------- | --------------- | ----------------------------- |
| `./utils`                 | 0 (same folder) | No — `allowSameFolder: true`  |
| `../sibling/utils`        | 1               | No — within `allowedDepth: 1` |
| `../../components/Button` | 2               | **Yes**                       |
| `../../../lib/api-client` | 3               | **Yes**                       |

**Auto-fix example**:

- Input: `import Button from '../../components/ui/Button'`
- Output: `import Button from '@/components/ui/Button'`

---

### Jest Module Name Mapper Entry

A key/value pair in `jest.moduleNameMapper` that mirrors an Alias Entry so Jest resolves the same paths without Webpack.

| Field         | Type         | Description                                     | Value for this project |
| ------------- | ------------ | ----------------------------------------------- | ---------------------- |
| `pattern`     | regex string | Matches the alias prefix in import statements   | `"^@/(.*)$"`           |
| `replacement` | string       | Absolute path within the Jest working directory | `"<rootDir>/src/$1"`   |

**Canonical location**: `frontend/package.json` → `jest.moduleNameMapper`  
**Current state**: Already configured correctly — no changes needed.

---

## Configuration Consistency Matrix

The table below shows which tool reads which configuration file for alias resolution:

| Tool                    | Config File                   | Alias Source                    | Status                |
| ----------------------- | ----------------------------- | ------------------------------- | --------------------- |
| Next.js build (Webpack) | `tsconfig.json` `paths`       | `@/*` → `./src/*`               | ✅ Already configured |
| TypeScript / IDE        | `tsconfig.json` `paths`       | `@/*` → `./src/*`               | ✅ Already configured |
| ESLint lint rule        | `.eslintrc.json` rule options | `rootDir: "src"`, `prefix: "@"` | ❌ To be added        |
| Jest `moduleNameMapper` | `package.json` `jest`         | `^@/(.*)$` → `<rootDir>/src/$1` | ✅ Already configured |

**Net change**: Only `.eslintrc.json` and `package.json` (new devDependency) need modification.
