Cypress.on('uncaught:exception', (err) => {
  // Leaflet and dynamic map rendering occasionally throw non-actionable errors in test mode.
  if (err.message.includes('ResizeObserver loop limit exceeded')) {
    return false;
  }

  return true;
});
