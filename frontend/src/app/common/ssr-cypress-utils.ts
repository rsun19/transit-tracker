// Utility to determine if SSR should be skipped for Cypress
export function shouldSkipSSRForCypress(): boolean {
  // SSR skip logic for Cypress
  if (typeof process !== 'undefined' && process.env.CYPRESS === 'true') {
    return true;
  }
  // Also check for the test user agent (for Vercel/hosted environments)
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Cypress')) {
    return true;
  }
  return false;
}
