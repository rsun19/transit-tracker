/// <reference types="cypress" />

describe('Stops area journeys', () => {
  beforeEach(() => {
    cy.intercept('GET', '/api/v1/stops**', {
      statusCode: 200,
      body: {
        data: [
          {
            id: 'stop-1',
            stopId: 'place-pktrm',
            stopName: 'Park Street',
            stopCode: '70196',
            lat: 42.3561,
            lon: -71.0622,
            wheelchairBoarding: 1,
          },
        ],
        total: 1,
      },
    }).as('stops');
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
