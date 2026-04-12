
#!/bin/bash
# Run local E2E workflow just like CI (dev server, Cypress, logs)
# Usage: npm run test:e2e:local OR make e2e-local

set -euo pipefail

# Start frontend in dev mode with CYPRESS=true, log output
CYPRESS=true npm --prefix frontend run dev > frontend-dev.log 2>&1 &
FRONTEND_PID=$!

# Wait for frontend to be ready
for i in {1..45}; do
  if curl -fsS http://127.0.0.1:3001 >/dev/null; then
    echo "Frontend ready!"
    break
  fi
  sleep 2
done
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
  echo "Frontend process died unexpectedly. See frontend-dev.log."
  exit 1
fi
if ! curl -fsS http://127.0.0.1:3001 >/dev/null; then
  echo "Frontend did not become ready in time. See frontend-dev.log."
  kill $FRONTEND_PID || true
  exit 1
fi

# Run Cypress E2E tests (map group by default)
CYPRESS_GROUP=map node scripts/e2e/run-cypress-group.mjs

# Stop frontend
kill $FRONTEND_PID
wait $FRONTEND_PID 2>/dev/null || true
