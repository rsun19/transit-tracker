/// <reference types="cypress" />

const STOP_ID = '70097';

const arrival = (overrides: Record<string, unknown> = {}) => ({
  tripId: 'trip-1',
  routeId: 'Red',
  routeShortName: 'Red',
  routeLongName: 'Red Line',
  headsign: 'Ashmont',
  realtimeArrival: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  realtimeDelaySeconds: null,
  hasRealtime: false,
  directionId: 1,
  ...overrides,
});

const isCI = !!process.env.CI;

(isCI ? describe.skip : describe)('Stop arrivals page', () => {
  describe('two-direction layout', () => {
    beforeEach(() => {
      cy.intercept('GET', `/api/v1/stops/${STOP_ID}/arrivals**`, {
        statusCode: 200,
        body: {
          stopId: STOP_ID,
          stopName: 'Alewife',
          agencyKey: 'mbta',
          data: [
            arrival({ tripId: 'trip-out', directionId: 0, headsign: 'Braintree' }),
            arrival({ tripId: 'trip-in', directionId: 1, headsign: 'Alewife' }),
          ],
        },
      }).as('arrivals');
      cy.intercept('GET', '/api/v1/alerts**', { statusCode: 200, body: { alerts: [] } }).as(
        'alerts',
      );
      cy.visit(`/stops/${STOP_ID}`);
      cy.wait(['@arrivals', '@alerts']);
    });

    it('shows Outbound and Inbound tables stacked vertically', () => {
      cy.contains('Outbound').should('be.visible');
      cy.contains('Inbound').should('be.visible');
    });

    it('places each arrival in the correct table', () => {
      cy.get('#dir-0').contains('Braintree').should('exist');
      cy.get('#dir-1').contains('Alewife').should('exist');
    });
  });

  describe('route chip label', () => {
    it('shows routeLongName for subway routes with empty shortName', () => {
      cy.intercept('GET', `/api/v1/stops/${STOP_ID}/arrivals**`, {
        statusCode: 200,
        body: {
          stopId: STOP_ID,
          stopName: 'Alewife',
          agencyKey: 'mbta',
          data: [arrival({ routeShortName: '', routeLongName: 'Red Line', directionId: 0 })],
        },
      }).as('arrivals');
      cy.intercept('GET', '/api/v1/alerts**', { statusCode: 200, body: { alerts: [] } });
      cy.visit(`/stops/${STOP_ID}`);
      cy.wait('@arrivals');
      cy.contains('Red Line').should('be.visible');
    });
  });

  describe('status chips', () => {
    function visitWithArr(arr: Record<string, unknown>) {
      cy.intercept('GET', `/api/v1/stops/${STOP_ID}/arrivals**`, {
        statusCode: 200,
        body: {
          stopId: STOP_ID,
          stopName: 'Alewife',
          agencyKey: 'mbta',
          data: [arrival({ ...arr, directionId: 0 })],
        },
      }).as('arrivals');
      cy.intercept('GET', '/api/v1/alerts**', { statusCode: 200, body: { alerts: [] } });
      cy.visit(`/stops/${STOP_ID}`);
      cy.wait('@arrivals');
    }

    it('shows (scheduled) for arrivals with no realtime', () => {
      visitWithArr({ hasRealtime: false, realtimeDelaySeconds: null });
      cy.contains('(scheduled)').should('be.visible');
    });

    it('shows "On Time" for realtime arrival with zero delay', () => {
      visitWithArr({ hasRealtime: true, realtimeDelaySeconds: 0 });
      cy.contains('On Time').should('be.visible');
    });

    it('shows "+N min" for a late arrival', () => {
      visitWithArr({ hasRealtime: true, realtimeDelaySeconds: 180 });
      cy.contains('+3 min').should('be.visible');
    });

    it('shows "N min early" for an early arrival', () => {
      visitWithArr({ hasRealtime: true, realtimeDelaySeconds: -120 });
      cy.contains('2 min early').should('be.visible');
    });
  });

  describe('empty state', () => {
    it('shows empty state when no arrivals returned', () => {
      cy.intercept('GET', `/api/v1/stops/${STOP_ID}/arrivals**`, {
        statusCode: 200,
        body: {
          stopId: STOP_ID,
          stopName: 'Alewife',
          agencyKey: 'mbta',
          data: [],
        },
      });
      cy.intercept('GET', '/api/v1/alerts**', { statusCode: 200, body: { alerts: [] } });
      cy.visit(`/stops/${STOP_ID}`);
      cy.contains('No upcoming arrivals').should('be.visible');
    });
  });
});
