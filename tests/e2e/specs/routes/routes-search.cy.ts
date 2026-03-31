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
