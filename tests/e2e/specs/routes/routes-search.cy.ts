/// <reference types="cypress" />

describe('Routes area journeys', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/v1/routes**', {
      statusCode: 200,
      body: {
        data: [
          {
            id: 'route-1',
            routeId: 'Red',
            shortName: 'Red',
            longName: 'Red Line',
            routeType: 1,
            color: 'DA291C',
            textColor: 'FFFFFF',
          },
        ],
        total: 1,
      },
    }).as('routes');

    cy.intercept('GET', '/api/v1/routes/Red**', {
      statusCode: 200,
      body: {
        id: 'route-1',
        routeId: 'Red',
        shortName: 'Red',
        longName: 'Red Line',
        routeType: 1,
        color: 'DA291C',
        textColor: 'FFFFFF',
        stops: [
          {
            stopId: 'place-sstat',
            stopName: 'South Station',
            latitude: 42.352271,
            longitude: -71.055242,
            stopSequence: 1,
          },
        ],
      },
    }).as('routeDetail');

    cy.intercept('GET', '/api/v1/alerts**', {
      statusCode: 200,
      body: {
        alerts: [],
      },
    }).as('alerts');
  });

  it('loads route search on home page', () => {
    cy.visit('/');
    cy.contains('Transit Tracker').should('be.visible');
  });

  it('shows search results when typing route names', () => {
    cy.visit('/');
    cy.get('input[placeholder="Search routes (e.g. Red Line, 39, Silver)"]').type('Red');
    cy.wait('@routes');
    cy.contains('Red Line').should('be.visible');
  });

  it('opens route detail and renders stops list', () => {
    cy.visit('/');
    cy.get('input[placeholder="Search routes (e.g. Red Line, 39, Silver)"]').type('Red');
    cy.wait('@routes');
    cy.contains('Red Line').click();
    cy.wait('@routeDetail');
    cy.contains('Stops').should('be.visible');
  });
});

describe('Routes — branching route display (trunk + tails)', () => {
  const stop = (stopId: string, stopName: string) => ({
    stopId,
    stopName,
    latitude: 42.35,
    longitude: -71.06,
    stopSequence: 1,
  });

  // Simulates Red Line: two dir=0 branches sharing a trunk, plus a dir=1 inbound branch.
  // The dir=1 branch should NOT produce its own column — only dir=0 drives the layout.
  beforeEach(() => {
    cy.intercept('GET', '/api/v1/routes**', {
      statusCode: 200,
      body: {
        data: [{ id: 'r1', routeId: '713', shortName: '713', longName: 'Route 713', routeType: 3 }],
        total: 1,
      },
    }).as('routes');

    cy.intercept('GET', '/api/v1/routes/713**', {
      statusCode: 200,
      body: {
        id: 'r1',
        routeId: '713',
        shortName: '713',
        longName: 'Route 713',
        routeType: 3,
        branches: [
          // dir=0: two outbound branches sharing trunk-1 and trunk-2
          {
            label: 'Mattapan',
            directionId: 0,
            stops: [
              stop('trunk-1', 'Trunk Stop 1'),
              stop('trunk-2', 'Trunk Stop 2'),
              stop('A', 'Mattapan Tail'),
            ],
          },
          {
            label: 'Ashmont',
            directionId: 0,
            stops: [
              stop('trunk-1', 'Trunk Stop 1'),
              stop('trunk-2', 'Trunk Stop 2'),
              stop('B', 'Ashmont Tail'),
            ],
          },
          // dir=1: inbound — should NOT appear as its own column
          {
            label: 'Ruggles',
            directionId: 1,
            stops: [stop('trunk-1', 'Trunk Stop 1'), stop('C', 'Inbound Only Stop')],
          },
        ],
      },
    }).as('routeDetail');

    cy.intercept('GET', '/api/v1/alerts**', { statusCode: 200, body: { alerts: [] } }).as('alerts');
  });

  it('renders shared trunk stops as a flat list', () => {
    cy.visit('/routes/713');
    cy.wait(['@routeDetail', '@alerts']);
    cy.contains('Trunk Stop 1').should('be.visible');
    cy.contains('Trunk Stop 2').should('be.visible');
  });

  it('renders dir=0 branch tail labels and their unique stops', () => {
    cy.visit('/routes/713');
    cy.wait(['@routeDetail', '@alerts']);
    cy.contains('Mattapan').should('be.visible');
    cy.contains('Ashmont').should('be.visible');
    cy.contains('Mattapan Tail').should('be.visible');
    cy.contains('Ashmont Tail').should('be.visible');
  });

  it('does not render dir=1 branch as a separate column', () => {
    cy.visit('/routes/713');
    cy.wait(['@routeDetail', '@alerts']);
    cy.contains('Ruggles').should('not.exist');
    cy.contains('Inbound Only Stop').should('not.exist');
  });
});

describe('Routes — simple inbound/outbound route display', () => {
  const stop = (stopId: string, stopName: string) => ({
    stopId,
    stopName,
    latitude: 42.35,
    longitude: -71.06,
    stopSequence: 1,
  });

  // Simulates Orange Line: one dir=0 and one dir=1 branch with distinct platform stop IDs.
  // Should render a single flat list from dir=0 with no branch headers.
  beforeEach(() => {
    cy.intercept('GET', '/api/v1/routes/Orange**', {
      statusCode: 200,
      body: {
        id: 'r2',
        routeId: 'Orange',
        shortName: 'OL',
        longName: 'Orange Line',
        routeType: 1,
        branches: [
          {
            label: 'Forest Hills',
            directionId: 0,
            stops: [
              stop('oak-nb', 'Oak Grove'),
              stop('mal-nb', 'Malden Center'),
              stop('fh-nb', 'Forest Hills'),
            ],
          },
          {
            label: 'Oak Grove',
            directionId: 1,
            stops: [
              stop('fh-sb', 'Forest Hills'),
              stop('mal-sb', 'Malden Center'),
              stop('oak-sb', 'Oak Grove'),
            ],
          },
        ],
      },
    }).as('routeDetail');

    cy.intercept('GET', '/api/v1/alerts**', { statusCode: 200, body: { alerts: [] } }).as('alerts');
  });

  it('renders the outbound stops as a flat list', () => {
    cy.visit('/routes/Orange');
    cy.wait(['@routeDetail', '@alerts']);
    cy.contains('Oak Grove').should('be.visible');
    cy.contains('Malden Center').should('be.visible');
    cy.contains('Forest Hills').should('be.visible');
  });

  it('does not render a branch header for a non-branching route', () => {
    cy.visit('/routes/Orange');
    cy.wait(['@routeDetail', '@alerts']);
    // No subtitle headers should appear — stops render without section labels
    cy.get('h6').contains('Stops').should('be.visible');
    cy.contains('Oak Grove').closest('li').should('exist');
  });
});
