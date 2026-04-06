/// <reference types="cypress" />

// Helper to stub geolocation to succeed with a fixed Boston coordinate.
// The global e2e.ts support file denies geo by default; use this in
// cy.visit({ onBeforeLoad }) for tests that require a successful location fix.
function grantGeo(win: Cypress.AUTWindow, lat = 42.358, lon = -71.06): void {
  Object.defineProperty(win.navigator, 'geolocation', {
    value: {
      getCurrentPosition: (success: (pos: unknown) => void) => {
        success({
          coords: {
            latitude: lat,
            longitude: lon,
            accuracy: 10,
            altitude: null,
            altitudeAccuracy: null,
            heading: null,
            speed: null,
          },
          timestamp: Date.now(),
        });
      },
    },
    configurable: true,
  });
}

const nearbyStop = (stopId: string, stopName: string, routes: unknown[]) => ({
  id: `id-${stopId}`,
  stopId,
  stopName,
  stopCode: stopId,
  lat: 42.358,
  lon: -71.06,
  wheelchairBoarding: 1,
  distanceMetres: 50,
  routes,
  nextDeparture: null,
});

function interceptNearby(stops: unknown[]) {
  cy.intercept(
    { method: 'GET', url: /\/api\/v1\/stops\/nearby/ },
    {
      statusCode: 200,
      body: { data: stops, searchCentre: { lat: 42.358, lon: -71.06 }, radiusMetres: 500 },
    },
  ).as('nearby');
}

function interceptAlerts() {
  cy.intercept('GET', '/api/v1/alerts**', { statusCode: 200, body: { alerts: [] } }).as('alerts');
}

// ─── Geolocation denied ──────────────────────────────────────────────────────

describe('Nearby stops — geolocation denied', () => {
  // Geolocation is denied globally (see tests/e2e/support/e2e.ts).

  it('shows the blocked message alert', () => {
    cy.visit('/stops/nearby');
    cy.contains('Location access is blocked').should('be.visible');
    cy.contains('enable location in your browser settings').should('be.visible');
  });

  it('shows manual coordinate inputs so the user can still search', () => {
    cy.visit('/stops/nearby');
    cy.get('input[aria-label="Latitude"]').should('be.visible');
    cy.get('input[aria-label="Longitude"]').should('be.visible');
  });
});

// ─── Colocated stop merging ───────────────────────────────────────────────────

describe('Nearby stops — colocated stop merging', () => {
  // Merging is performed server-side in getNearbyStops (stops.service.ts).
  // These tests verify that the frontend correctly renders the already-merged
  // API response: one card per merged group, showing all combined route chips.

  it('shows one card and all merged route chips when the API returns a merged stop', () => {
    interceptAlerts();
    interceptNearby([
      nearbyStop('stop-merged', 'Washington St @ Tufts Med Ctr', [
        { routeId: '11', shortName: '11', longName: 'Route 11', routeType: 3 },
        { routeId: '15', shortName: '15', longName: 'Route 15', routeType: 3 },
        { routeId: 'SL4', shortName: 'SL4', longName: 'Silver Line 4', routeType: 3 },
        { routeId: 'SL5', shortName: 'SL5', longName: 'Silver Line 5', routeType: 3 },
      ]),
    ]);

    cy.visit('/stops/nearby', { onBeforeLoad: (win) => grantGeo(win) });
    cy.wait(['@nearby', '@alerts']);

    cy.contains('Washington St @ Tufts Med Ctr').should('have.length', 1);
    cy.contains('11').should('be.visible');
    cy.contains('15').should('be.visible');
    cy.contains('SL4').should('be.visible');
    cy.contains('SL5').should('be.visible');
  });

  it('shows distinct cards when API returns stops with different names', () => {
    interceptAlerts();
    interceptNearby([
      nearbyStop('stop-A', 'Park Street Inbound', [
        { routeId: 'Red', shortName: null, longName: 'Red Line', routeType: 1 },
      ]),
      nearbyStop('stop-B', 'Park Street Outbound', [
        { routeId: 'Red', shortName: null, longName: 'Red Line', routeType: 1 },
      ]),
    ]);

    cy.visit('/stops/nearby', { onBeforeLoad: (win) => grantGeo(win) });
    cy.wait(['@nearby', '@alerts']);

    cy.contains('Park Street Inbound').should('be.visible');
    cy.contains('Park Street Outbound').should('be.visible');
  });
});
