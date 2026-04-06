// Deny geolocation for all tests so the /stops page stays in search mode
// and never triggers fetchNearbyStops unexpectedly. Tests that need geo
// can override this per-test via cy.visit({ onBeforeLoad }).
Cypress.on('window:before:load', (win) => {
  Object.defineProperty(win.navigator, 'geolocation', {
    value: {
      getCurrentPosition: (_success: (pos: unknown) => void, error: (err: unknown) => void) => {
        error({
          code: 1,
          message: 'User denied Geolocation',
          PERMISSION_DENIED: 1,
          POSITION_UNAVAILABLE: 2,
          TIMEOUT: 3,
        });
      },
    },
    configurable: true,
  });
});

Cypress.on('uncaught:exception', (err) => {
  // Leaflet and dynamic map rendering occasionally throw non-actionable errors in test mode.
  if (err.message.includes('ResizeObserver loop limit exceeded')) {
    return false;
  }

  return true;
});
