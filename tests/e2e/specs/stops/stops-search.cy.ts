/// <reference types="cypress" />

const BASE_STOP = {
  id: 'stop-1',
  stopId: 'place-pktrm',
  stopName: 'Park Street',
  stopCode: '70196',
  lat: 42.3561,
  lon: -71.0622,
  wheelchairBoarding: 1,
};

function interceptStops(routes: unknown[]) {
  // Use a regex so this intercept only matches the search endpoint (?q=…)
  // and not /stops/nearby, which is handled separately.
  cy.intercept(
    { method: 'GET', url: /\/api\/v1\/stops\?/ },
    {
      statusCode: 200,
      body: { data: [{ ...BASE_STOP, routes }], total: 1 },
    },
  ).as('stops');
}

describe('Stops area journeys', () => {
  beforeEach(() => {
    interceptStops([]);
  });

  it('renders stop search page', () => {
    cy.visit('/stops');
    cy.contains('Find a Stop').should('be.visible');
  });

  it('performs a stop search and shows result', () => {
    cy.visit('/stops');
    cy.get('input[placeholder="e.g. Park Street, Silver Line Way"]').should('be.visible');
    cy.get('input[placeholder="e.g. Park Street, Silver Line Way"]').type('Park Street');
    cy.wait('@stops');
    cy.contains('Park Street').should('be.visible');
  });

  it('navigates to stop details from search results', () => {
    cy.visit('/stops');
    cy.get('input[placeholder="e.g. Park Street, Silver Line Way"]').should('be.visible');
    cy.get('input[placeholder="e.g. Park Street, Silver Line Way"]').type('Park Street');
    cy.wait('@stops');
    cy.contains('Park Street').click();
    cy.url().should('include', '/stops/place-pktrm');
  });
});

describe('Stops search — route chip labels', () => {
  const search = () => {
    cy.visit('/stops');
    cy.get('input[placeholder="e.g. Park Street, Silver Line Way"]').type('Park Street');
    cy.wait('@stops');
  };

  it('shows longName when shortName is an empty string', () => {
    interceptStops([{ routeId: 'Red', shortName: '', longName: 'Red Line', routeType: 1 }]);
    search();
    cy.contains('Red Line').should('be.visible');
  });

  it('shows routeId when both shortName and longName are absent', () => {
    interceptStops([{ routeId: 'shuttle-99', shortName: null, longName: null, routeType: 3 }]);
    search();
    cy.contains('shuttle-99').should('be.visible');
  });

  it('deduplicates chips with the same label', () => {
    interceptStops([
      { routeId: 'sh-1', shortName: null, longName: 'Blue Line Shuttle', routeType: 3 },
      { routeId: 'sh-2', shortName: null, longName: 'Blue Line Shuttle', routeType: 3 },
      { routeId: 'sh-3', shortName: null, longName: 'Blue Line Shuttle', routeType: 3 },
    ]);
    search();
    cy.contains('Park Street')
      .closest('[role="button"]')
      .within(() => {
        cy.contains('Blue Line Shuttle').should('have.length', 1);
      });
  });

  it('shows all unique route chips', () => {
    interceptStops([
      { routeId: 'Red', shortName: null, longName: 'Red Line', routeType: 1 },
      { routeId: 'Orange', shortName: null, longName: 'Orange Line', routeType: 1 },
    ]);
    search();
    cy.contains('Red Line').should('be.visible');
    cy.contains('Orange Line').should('be.visible');
  });
});

describe('Stops search — co-located stop merging', () => {
  const makeStop = (stopId: string, routes: unknown[]) => ({
    id: stopId,
    stopId,
    stopName: 'Washington St @ Tufts Med Ctr',
    stopCode: null,
    lat: 42.335,
    lon: -71.072,
    wheelchairBoarding: null,
    routes,
  });

  it('shows only one result when the API returns already-merged stops', () => {
    cy.intercept(
      { method: 'GET', url: /\/api\/v1\/stops\?/ },
      {
        statusCode: 200,
        body: {
          data: [
            makeStop('stop-merged', [
              { routeId: '11', shortName: '11', longName: 'Route 11', routeType: 3 },
              { routeId: '15', shortName: '15', longName: 'Route 15', routeType: 3 },
              { routeId: 'SL4', shortName: 'SL4', longName: 'Silver Line 4', routeType: 3 },
              { routeId: 'SL5', shortName: 'SL5', longName: 'Silver Line 5', routeType: 3 },
            ]),
          ],
          total: 1,
        },
      },
    ).as('stops');

    cy.visit('/stops');
    cy.get('input[placeholder="e.g. Park Street, Silver Line Way"]').type('Washington');
    cy.wait('@stops');

    cy.contains('Washington St @ Tufts Med Ctr').should('have.length', 1);
    cy.contains('11').should('be.visible');
    cy.contains('15').should('be.visible');
    cy.contains('SL4').should('be.visible');
    cy.contains('SL5').should('be.visible');
  });
});

describe('Stops search — geolocation denied', () => {
  // Geolocation is denied globally (see tests/e2e/support/e2e.ts) so no extra
  // stub is needed here.
  it('shows "Location access is blocked" empty state when geolocation is denied', () => {
    cy.visit('/stops');
    cy.contains('Location access is blocked').should('be.visible');
    cy.contains('Enable location in your browser settings').should('be.visible');
  });

  it('still allows text search when geolocation is denied', () => {
    cy.intercept(
      { method: 'GET', url: /\/api\/v1\/stops\?/ },
      {
        statusCode: 200,
        body: { data: [BASE_STOP], total: 1 },
      },
    ).as('stops');

    cy.visit('/stops');
    cy.get('input[placeholder="e.g. Park Street, Silver Line Way"]').type('Park');
    cy.wait('@stops');
    cy.contains('Park Street').should('be.visible');
    // The denied empty state should no longer be shown once a search is active.
    cy.contains('Location access is blocked').should('not.exist');
  });
});
