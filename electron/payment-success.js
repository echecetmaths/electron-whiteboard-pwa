// Landing page for the PWA-specific Stripe payment links (see api-shim.js's PAYMENT_LINK_*
// constants) — same origin as the app, so it can message the opener directly instead of
// needing the desktop app's cross-window-navigation-interception trick, which only works
// for a same-process BrowserWindow and has no browser equivalent for a real popup.
(function () {
  const sessionId = new URLSearchParams(window.location.search).get('session_id');
  if (window.opener) {
    window.opener.postMessage({ type: 'electron-payment-complete', sessionId }, '*');
  }
  setTimeout(() => { try { window.close(); } catch (e) {} }, 1500);
})();
