// ---------- Browser replacement for preload.js's window.api ----------
// app.js is shared byte-for-byte with the desktop app and only ever touches Electron through
// window.api — so implementing that same surface here, backed by IndexedDB + fetch + the
// browser's own file/window APIs, lets the whole whiteboard engine run unmodified in a tab.
(function () {
  'use strict';

  const LICENSE_WORKER_BASE = 'https://electron.echecetmaths-coursparticuliers.workers.dev';
  // Separate from the desktop app's payment links (main.js) — these redirect to this app's own
  // payment-success.html instead of echecetmaths.com, since only a same-origin landing page lets
  // this shim detect completion at all (a plain window.open() popup can't be inspected once it
  // navigates to Stripe's cross-origin checkout, unlike the desktop app's BrowserWindow).
  const STRIPE_PAYMENT_LINK_MONTHLY = 'https://buy.stripe.com/aFaeVd9BL9tNg1EcTz2sM1i'; // 4,99€ / mois
  const STRIPE_PAYMENT_LINK_YEARLY = 'https://buy.stripe.com/dRm3cv7tD7lF16K3iZ2sM1j'; // 49,99€ / an
  const DEFAULT_FOOTER_TEXT = 'Propulsé par Echec & Maths - Cours particuliers';

  // ---------- IndexedDB ----------
  const DB_NAME = 'electron-whiteboard';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('boards')) db.createObjectStore('boards', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbGet(store, key) {
    const db = await openDb();
    return reqToPromise(db.transaction(store, 'readonly').objectStore(store).get(key));
  }
  async function idbGetAll(store) {
    const db = await openDb();
    return reqToPromise(db.transaction(store, 'readonly').objectStore(store).getAll());
  }
  async function idbPut(store, value, key) {
    const db = await openDb();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  }
  async function idbDelete(store, key) {
    const db = await openDb();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  }

  function makeId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }
  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = () => resolve(input.files[0] || null);
      input.click();
    });
  }

  // ---------- Settings ----------
  function defaultSettings() {
    return {
      email: '',
      subscriptionActive: false,
      subscriptionCheckedAt: 0,
      cancelAtPeriodEnd: false,
      shortcuts: {},
      pdfPrefs: {
        footerText: DEFAULT_FOOTER_TEXT,
        headerText: null,
        logoPath: null,
        endPdfPath: null,
        showCover: true,
        showEnd: true,
        showHeader: true,
        showFooter: true,
        showPageNumbers: true,
        showStars: true,
        showLogo: true,
        showMeteors: true
      }
    };
  }
  async function readSettings() {
    const saved = await idbGet('kv', 'settings');
    const def = defaultSettings();
    if (!saved) return def;
    return { ...def, ...saved, pdfPrefs: { ...def.pdfPrefs, ...(saved.pdfPrefs || {}) } };
  }
  async function writeSettings(s) { await idbPut('kv', s, 'settings'); }

  // ---------- Subscription portal (real Stripe-hosted tab, not an embedded view) ----------
  let portalReadyCb = null;
  let portalClosedCb = null;
  let paymentCompletedCb = null;

  // The PWA's payment links redirect back to this app's own payment-success.html (same origin),
  // which posts the completed session's id back here — this is the browser-safe equivalent of
  // the desktop app's cross-window-navigation interception, which has no popup equivalent.
  window.addEventListener('message', async (event) => {
    if (!event.data || event.data.type !== 'electron-payment-complete') return;
    if (!paymentCompletedCb) return;
    const sessionId = event.data.sessionId;
    if (!sessionId) { paymentCompletedCb({ ok: false, error: 'missing_session' }); return; }
    try {
      const res = await fetch(`${LICENSE_WORKER_BASE}/session-email?session_id=${encodeURIComponent(sessionId)}`);
      if (!res.ok) { paymentCompletedCb({ ok: false, error: 'server_error' }); return; }
      const data = await res.json();
      if (!data.email) { paymentCompletedCb({ ok: false, error: 'no_email' }); return; }
      const trimmed = data.email.trim().toLowerCase();
      const settings = await readSettings();
      settings.email = trimmed;
      await writeSettings(settings);
      paymentCompletedCb({ ok: true, email: trimmed });
    } catch (err) {
      paymentCompletedCb({ ok: false, error: 'network_error' });
    }
  });

  // ---------- window.api ----------
  window.api = {
    // Boards
    listBoards: async () => {
      const boards = await idbGetAll('boards');
      return boards
        .map((b) => ({ id: b.id, name: b.name, updatedAt: b.updatedAt, createdAt: b.createdAt, thumbnail: b.thumbnail || null }))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    loadBoard: async (id) => (await idbGet('boards', id)) || null,
    saveBoard: async (board) => {
      board.updatedAt = Date.now();
      await idbPut('boards', board);
      return { ok: true, updatedAt: board.updatedAt };
    },
    createBoard: async (name) => {
      const now = Date.now();
      const board = { id: makeId(), name: name || 'Tableau sans titre', createdAt: now, updatedAt: now, objects: [], viewport: { panX: 0, panY: 0, zoom: 1 }, thumbnail: null };
      await idbPut('boards', board);
      return board;
    },
    renameBoard: async (id, name) => {
      const board = await idbGet('boards', id);
      if (!board) return { ok: false };
      board.name = name;
      board.updatedAt = Date.now();
      await idbPut('boards', board);
      return { ok: true };
    },
    deleteBoard: async (id) => { await idbDelete('boards', id); return { ok: true }; },
    duplicateBoard: async (id) => {
      const board = await idbGet('boards', id);
      if (!board) return null;
      const now = Date.now();
      const copy = { ...board, id: makeId(), name: board.name + ' (copie)', createdAt: now, updatedAt: now };
      await idbPut('boards', copy);
      return copy;
    },

    // Settings
    getSettings: readSettings,
    setSettings: async (patch) => {
      const current = await readSettings();
      const merged = { ...current, ...patch };
      if (patch.pdfPrefs) merged.pdfPrefs = { ...current.pdfPrefs, ...patch.pdfPrefs };
      await writeSettings(merged);
      return merged;
    },

    // Subscription
    checkSubscription: async (email) => {
      const trimmed = (email || '').trim().toLowerCase();
      if (!trimmed) return { ok: false, error: 'missing_email' };
      const settings = await readSettings();
      settings.email = trimmed;
      await writeSettings(settings);
      try {
        const res = await fetch(`${LICENSE_WORKER_BASE}/check?email=${encodeURIComponent(trimmed)}`);
        if (!res.ok) return { ok: false, error: 'server_error' };
        const data = await res.json();
        settings.subscriptionActive = !!data.active;
        settings.subscriptionCheckedAt = Date.now();
        if (!settings.subscriptionActive) settings.cancelAtPeriodEnd = false;
        await writeSettings(settings);
        return { ok: true, active: settings.subscriptionActive };
      } catch (err) {
        return { ok: false, error: 'network_error' };
      }
    },
    getSubscriptionDetails: async (email) => {
      const trimmed = (email || '').trim().toLowerCase();
      if (!trimmed) return { ok: false, error: 'missing_email' };
      try {
        const res = await fetch(`${LICENSE_WORKER_BASE}/subscription?email=${encodeURIComponent(trimmed)}`);
        if (!res.ok) return { ok: false, error: 'server_error' };
        const data = await res.json();
        if (data.active) {
          const settings = await readSettings();
          settings.cancelAtPeriodEnd = !!data.cancelAtPeriodEnd;
          await writeSettings(settings);
        }
        return { ok: true, ...data };
      } catch (err) {
        return { ok: false, error: 'network_error' };
      }
    },

    // Payment — opens the real Stripe Payment Link in its own tab. A web page can't watch an
    // external tab's navigation the way the desktop app's BrowserWindow does, so there's no
    // auto-detection here; the app's existing "Vérifier" flow (already built for the offline/
    // failure case) is what picks the subscription up once the user comes back.
    openPayment: async (plan) => {
      const link = plan === 'yearly' ? STRIPE_PAYMENT_LINK_YEARLY : STRIPE_PAYMENT_LINK_MONTHLY;
      const settings = await readSettings();
      const target = new URL(link);
      if (settings.email) target.searchParams.set('prefilled_email', settings.email);
      window.open(target.toString(), '_blank', 'noopener');
    },
    onPaymentCompleted: (cb) => { paymentCompletedCb = cb; },

    // Subscription management portal — same idea: a real tab instead of an embedded native view.
    openSubscriptionPortal: async (email) => {
      const trimmed = (email || '').trim().toLowerCase();
      if (!trimmed) return { ok: false, error: 'missing_email' };
      try {
        const res = await fetch(`${LICENSE_WORKER_BASE}/portal`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: trimmed })
        });
        if (!res.ok) return { ok: false, error: 'server_error' };
        const data = await res.json();
        if (!data.url) return { ok: false, error: 'no_url' };
        return { ok: true, url: data.url };
      } catch (err) {
        return { ok: false, error: 'network_error' };
      }
    },
    embedPortal: async (url) => {
      // Nothing to embed in a tab — dismiss the app's own "loading portal" modal immediately and
      // hand off to a real Stripe-hosted tab instead.
      const modal = document.getElementById('portal-modal');
      if (modal) modal.classList.add('hidden');
      const win = window.open(url, '_blank', 'noopener');
      if (!win) return { ok: false, error: 'popup_blocked' };
      const poll = setInterval(() => {
        if (win.closed) { clearInterval(poll); if (portalClosedCb) portalClosedCb(); }
      }, 700);
      return { ok: true };
    },
    onPortalReady: (cb) => { portalReadyCb = cb; },
    onPortalClosed: (cb) => { portalClosedCb = cb; },
    updatePortalBounds: () => {},
    closePortalEmbed: () => {},

    // Custom logo / end-page PDF — stored as data URLs directly in settings (no filesystem to
    // copy into on the web), so getLogoDataUrl just returns what pickLogo already stored.
    pickLogo: async () => {
      const file = await pickFile('image/png,image/jpeg,image/svg+xml,image/webp');
      if (!file) return { ok: false };
      const dataUrl = await fileToDataUrl(file);
      const settings = await readSettings();
      settings.pdfPrefs.logoPath = dataUrl;
      await writeSettings(settings);
      return { ok: true, path: dataUrl };
    },
    clearLogo: async () => {
      const settings = await readSettings();
      settings.pdfPrefs.logoPath = null;
      await writeSettings(settings);
      return settings;
    },
    pickEndPdf: async () => {
      const file = await pickFile('application/pdf');
      if (!file) return { ok: false };
      const dataUrl = await fileToDataUrl(file);
      const settings = await readSettings();
      settings.pdfPrefs.endPdfPath = dataUrl;
      await writeSettings(settings);
      return { ok: true, path: dataUrl };
    },
    clearEndPdf: async () => {
      const settings = await readSettings();
      settings.pdfPrefs.endPdfPath = null;
      await writeSettings(settings);
      return settings;
    },
    getLogoDataUrl: async () => {
      const settings = await readSettings();
      return settings.pdfPrefs.logoPath || null;
    },

    // Opening a placed file object on the canvas — its .src is already a data URL (inserted via
    // FileReader), so "opening" it is just letting the browser display/download it in a new tab.
    openFile: async (dataUrl) => {
      const win = window.open(dataUrl, '_blank', 'noopener');
      return { ok: !!win };
    },

    openPromoSite: async () => { window.open('https://echecetmaths.com', '_blank', 'noopener'); },

    // PDF export — built entirely client-side with pdf-lib (see pdf-export.js), then handed to
    // the browser as a normal download instead of a native Save As dialog.
    exportPdfFull: async (payload) => {
      try {
        const blob = await window.buildExportPdfBlob(payload);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (payload.boardName || 'tableau') + '.pdf';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        return { ok: true };
      } catch (err) {
        console.error('PDF export failed', err);
        return { ok: false };
      }
    }
  };
})();
