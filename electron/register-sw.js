// Skipped on the Capacitor build: its assets are already local, so a service worker in front of
// the WebView's own scheme would only add a stale-cache failure mode.
const IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if ('serviceWorker' in navigator && !IS_NATIVE) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'));
}
