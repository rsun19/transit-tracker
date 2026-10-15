# Frontend arrival display: timezone, past rows, MBTA-style countdown

**Type:** bug fix plus UX
**Touches:** `frontend/src/components/stops/ArrivalRow.tsx`, `frontend/src/app/stops/[stopId]/StopArrivalsClient.tsx`, `ArrivalTable.tsx`, `frontend/src/lib/api-client.ts`, tests
**Depends on:** PR 03 (uses `status`, `predictedTime`, `scheduledTime`)

## Problem

1. **Times are formatted in the viewer's timezone.** `ArrivalRow.tsx:26` calls `toLocaleTimeString([], …)` with no `timeZone`. Anyone whose device isn't on Eastern time (travelers, a misconfigured device, CI or screenshots) sees times shifted by hours. MBTA's site always shows Boston time.
2. **Departed trains still show in the ungrouped view.** `StopArrivalsClient.tsx:88-93` builds `filteredArrivals`, but the single-table branch renders the unfiltered `arrivals` (`:157`). The empty-state check also uses `arrivals.length` (`:150`). At a one-direction stop (most bus stops), departed vehicles stay on screen until the next poll replaces them.
3. **The status chip is derived from `realtimeDelaySeconds`.** It's always 0 today, so every row says "On Time" (see PR 02 #1). After PR 03, use the server `status` field.
4. **MBTA shows minutes, the app shows clock time.** For subway and bus, MBTA's site shows "Arriving", "Boarding" or "N min". For Commuter Rail it shows clock time plus a status. Comparing `5:42 PM` with "6 min" invites the reaction "the times are different" even when they agree. Minutes rounded down in the app versus up on MBTA can also look like a 1-minute disagreement.
5. **No feed-age indicator.** If the worker stalls, nothing tells the user that predictions are stale.
6. **The polling loop doesn't fetch on mount** (it waits the first 15 s on SSR data), and it keeps polling in background tabs.

## Changes

1. Format with `Intl.DateTimeFormat('en-US', { timeZone: agency.timezone, hour: 'numeric', minute: '2-digit' })`. The timezone comes from the agencies endpoint (`GET /api/v1/agencies` already returns it, `agencies.controller.ts:14`), or from a `timezone` field added to the arrivals response.
2. Render `filteredArrivals` in both branches, and use `filteredArrivals.length` for the empty state. Also tick `now` every 1 s for the countdown, separately from the 15 s fetch.
3. Status chip comes from `arrival.status`: canceled → strikethrough plus a "Canceled" chip, or hidden. Skipped stops are hidden server-side.
4. Countdown column, following MBTA's documented display rules (https://www.mbta.com/developers/v3-api/best-practices, "Displaying predictions"):
   - Roughly: vehicle stopped at the stop and departing soon → "Boarding"; ≤ 30 s → "Arriving"; ≤ 60 s → "Approaching"; otherwise minutes. Above about 20 min, show "20+ min" or the clock time. **These thresholds and the rounding direction are from memory. Copy the exact values from the MBTA page before implementing**; rounding is the most likely cause of the remaining ±1 min "discrepancies".
   - Commuter Rail (`routeType === 2`): show clock time and status, and no countdown.
   - Uncertainty: the live feed carries `uncertainty` values of 60, 120, 300 and 360 s. Optionally de-emphasize the high values. Check how MBTA interprets them before choosing a cutoff.
5. Show "Updated Ns ago" from a `feedTimestamp` returned by the API. Show a warning when it's older than 2 minutes.
6. `usePolling` already exists in `frontend/src/lib/hooks/usePolling.ts`; use it, with `document.visibilityState` gating.

## Tests

- `ArrivalRow.spec.tsx`: renders Boston time when `process.env.TZ = 'America/Los_Angeles'`; countdown thresholds; Commuter Rail shows clock time.
- `StopArrivalsClient` spec: a past arrival isn't rendered in the ungrouped view.
- The axe accessibility specs still pass (strikethrough needs an accessible "canceled" label).
