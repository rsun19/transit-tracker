# Quickstart: Webpack Path Aliases & ESLint Enforcement

**Phase 1 output for**: `003-webpack-path-aliases`  
**Date**: 2026-03-31

---

## What this feature delivers

- The `@/` alias (e.g., `@/components/Button`, `@/lib/api-client`) resolves correctly in builds, TypeScript, and Jest — this was already working before this feature.
- **New**: ESLint now reports an error for any import that traverses two or more directory levels up (`../../` or deeper) when the `@/` alias could be used instead.
- **New**: `eslint --fix` automatically rewrites those imports to use the alias.

---

## Setup (one-time, after the PR merges)

```bash
# Install the new dev dependency
cd frontend
npm install
```

That's it. No other setup is required.

---

## Using import aliases

Write alias imports like this:

```tsx
// Good — uses the @/ alias
import { StopCard } from '@/components/stops/StopCard';
import { useNearbyStops } from '@/lib/hooks/useNearbyStops';
import { ApiClient } from '@/lib/api-client';

// Also OK — single-level relative (same-folder or direct sibling)
import { formatTime } from '../utils/time';
import styles from './MapView.module.css';

// Bad — two or more levels up (ESLint will error)
import { StopCard } from '../../components/stops/StopCard'; // ❌
import { ApiClient } from '../../../lib/api-client'; // ❌
```

---

## Running the linter

```bash
# Check for violations
cd frontend
npm run lint

# Auto-fix all violations
npm run lint:fix
```

Sample output when a violation exists:

```
/Users/you/transit-tracker/frontend/src/app/map/page.tsx
  5:1  error  Relative import paths are not allowed. Use "@/components/map/VehicleMap" instead  no-relative-import-paths/no-relative-import-paths
```

---

## Adding a new alias

If you need to add a second alias (e.g., `@components/*` → `src/components`):

1. **Add to `frontend/tsconfig.json`** under `compilerOptions.paths`:

   ```json
   "@components/*": ["./src/components/*"]
   ```

2. **Add to `frontend/package.json`** under `jest.moduleNameMapper`:

   ```json
   "^@components/(.*)$": "<rootDir>/src/components/$1"
   ```

3. **Update `frontend/.eslintrc.json`** rule options if the new prefix uses a different root dir or prefix than `@/`.

> In most cases, the `@/*` alias covers everything under `src/` and no second alias is needed.

---

## CI behaviour

The `lint` job in `.github/workflows/ci.yml` runs `npm run lint` with `--max-warnings 0`. Any import violation will fail the job and block the pull request from merging.
