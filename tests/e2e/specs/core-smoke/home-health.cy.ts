/// <reference types="cypress" />

describe('Core smoke journeys', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/v1/routes**', {
      statusCode: 200,
      body: {
        data: [],
        total: 0,
      },
    }).as('routes');

    cy.intercept('GET', '/api/v1/stops**', {
      statusCode: 200,
      body: {
        data: [],
        total: 0,
      },
    }).as('stops');

    cy.intercept('GET', '/api/v1/vehicles/live**', {
      statusCode: 200,
      body: {
        data: [
          {
            agencyKey: 'mbta',
            vehicles: [],
          },
        ],
      },
    }).as('vehicles');

    cy.intercept('GET', '/api/v1/alerts**', {
      statusCode: 200,
      body: {
        alerts: [],
      },
    }).as('alerts');
  });

  it('home page responds and renders heading', () => {
    cy.visit('/');
    cy.contains('Transit Tracker').should('be.visible');
  });

  it('stops page responds and renders heading', () => {
    cy.visit('/stops');
    cy.contains('Find a Stop').should('be.visible');
  });

  it('map page responds and renders heading', () => {
    cy.visit('/map');
    cy.contains('Live Vehicle Map').should('be.visible');
  });
});
