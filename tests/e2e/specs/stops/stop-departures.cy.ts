/// <reference types="cypress" />

const STOP_ID = '70097';

const departure = (overrides: Record<string, unknown> = {}) => ({
  tripId: 'trip-1',
  routeId: 'Red',
  routeShortName: 'Red',
  routeLongName: 'Red Line',
  headsign: 'Ashmont',
  scheduledDeparture: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  realtimeDelaySeconds: null,
  hasRealtime: false,
  directionId: 1,
  ...overrides,
});

describe('Stop departures page', () => {
  describe('two-direction layout', () => {
    beforeEach(() => {
      cy.intercept('GET', `/api/v1/stops/${STOP_ID}/departures**`, {
        statusCode: 200,
        body: {
          stopId: STOP_ID,
          stopName: 'Alewife',
          agencyKey: 'mbta',
          data: [
            departure({ tripId: 'trip-out', directionId: 0, headsign: 'Braintree' }),
            departure({ tripId: 'trip-in', directionId: 1, headsign: 'Alewife' }),
          ],
        },
      }).as('departures');
      cy.intercept('GET', '/api/v1/alerts**', { statusCode: 200, body: { alerts: [] } }).as(
        'alerts',
      );
      cy.visit(`/stops/${STOP_ID}`);
      cy.wait(['@departures', '@alerts']);
    });

    it('shows Outbound and Inbound tables stacked vertically', () => {
      cy.contains('Outbound').should('be.visible');
      cy.contains('Inbound').should('be.visible');
    });

    it('places each departure in the correct table', () => {
      cy.contains('Outbound').parent().contains('Braintree').should('exist');
      cy.contains('Inbound').parent().contains('Alewife').should('exist');
    });
  });

  describe('route chip label', () => {
    it('shows routeLongName for subway routes with empty shortName', () => {
      cy.intercept('GET', `/api/v1/stops/${STOP_ID}/departures**`, {
        statusCode: 200,
        body: {
          stopId: STOP_ID,
          stopName: 'Alewife',
          agencyKey: 'mbta',
          data: [departure({ routeShortName: '', routeLongName: 'Red Line', directionId: 0 })],
        },
      }).as('departures');
      cy.intercept('GET', '/api/v1/alerts**', { statusCode: 200, body: { alerts: [] } });
      cy.visit(`/stops/${STOP_ID}`);
      cy.wait('@departures');
      cy.contains('Red Line').should('be.visible');
    });
  });

  describe('status chips', () => {
    function visitWithDep(dep: Record<string, unknown>) {
      cy.intercept('GET', `/api/v1/stops/${STOP_ID}/departures**`, {
        statusCode: 200,
        body: {
          stopId: STOP_ID,
          stopName: 'Alewife',
          agencyKey: 'mbta',
          data: [departure({ ...dep, directionId: 0 })],
        },
      }).as('departures');
      cy.intercept('GET', '/api/v1/alerts**', { statusCode: 200, body: { alerts: [] } });
      cy.visit(`/stops/${STOP_ID}`);
      cy.wait('@departures');
    }

    it('shows (scheduled) for departures with no realtime', () => {
      visitWithDep({ hasRealtime: false, realtimeDelaySeconds: null });
      cy.contains('(scheduled)').should('be.visible');
    });

    it('shows "On Time" for realtime departure with zero delay', () => {
      visitWithDep({ hasRealtime: true, realtimeDelaySeconds: 0 });
      cy.contains('On Time').should('be.visible');
    });

    it('shows "+N min" for a late departure', () => {
      visitWithDep({ hasRealtime: true, realtimeDelaySeconds: 180 });
      cy.contains('+3 min').should('be.visible');
    });

    it('shows "N min early" for an early departure', () => {
      visitWithDep({ hasRealtime: true, realtimeDelaySeconds: -120 });
      cy.contains('2 min early').should('be.visible');
    });
  });

  describe('empty state', () => {
    it('shows empty state when no departures returned', () => {
      cy.intercept('GET', `/api/v1/stops/${STOP_ID}/departures**`, {
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
      cy.contains('No upcoming departures').should('be.visible');
    });
  });
});
