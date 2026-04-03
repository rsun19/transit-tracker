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
  cy.intercept('GET', '/api/v1/stops**', {
    statusCode: 200,
    body: { data: [{ ...BASE_STOP, routes }], total: 1 },
  }).as('stops');
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
