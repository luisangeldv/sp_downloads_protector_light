
// Downloads Protector (Cloud) - Background Service Worker (MV3)
// Delegates protection to a backend. Pauses matching downloads, asks backend to fetch & protect,
// swaps the file by canceling original and downloading the protected one.

// === ENV (user-configurable via options.html) ===
const DEFAULTS = {
  serviceBaseUrl: "https://YOUR-RENDER-SERVICE.onrender.com",
  apiKey: "", // API key vinculado a tu cuenta (se obtiene desde el panel del servicio). Opcional si usas cookies sesión.
  enableLogging: true,
  enableProtection: true,
  renameSuffix: "_PRT",
  overwriteIfExists: true,
  providersEnabled: {}, // { "box": true, "onedrive": true, ... }
  patterns: [] // array de regex strings para URLs de descarga
};

// In-memory cache
let settings = Object.assign({}, DEFAULTS);
let lastConfigPullAt = 0;
const CONFIG_TTL_MS = 60_000; // re-fetch cada 60 s

// Logging helper
function log(...args) {
  if (settings.enableLogging) console.log("[DP-Cloud]", ...args);
}

// Storage helpers
async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get({ cloudSettings: DEFAULTS }, ({ cloudSettings }) => {
      settings = Object.assign({}, DEFAULTS, cloudSettings);
      resolve(settings);
    });
  });
}

async function saveSettings(newSettings) {
  settings = Object.assign({}, settings, newSettings);
  return chrome.storage.local.set({ cloudSettings: settings });
}

// Pull remote config from service (if logged-in or using API key)
async function maybeRefreshRemoteConfig() {
  const now = Date.now();
  if (now - lastConfigPullAt < CONFIG_TTL_MS) return;
  lastConfigPullAt = now;

  try {
    const resp = await fetch(`${settings.serviceBaseUrl}/api/config`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {})
      },
      // if using EntraID session-cookie auth, allow cookies
      credentials: settings.apiKey ? "omit" : "include"
    });
    if (!resp.ok) {
      log("remote config fetch failed", resp.status);
      return;
    }
    const cfg = await resp.json();
    const merged = {
      ...settings,
      enableProtection: !!cfg.enableProtection,
      renameSuffix: cfg.renameSuffix ?? settings.renameSuffix,
      overwriteIfExists: !!cfg.overwriteIfExists,
      providersEnabled: cfg.providersEnabled || {},
      patterns: Array.isArray(cfg.patterns) ? cfg.patterns : []
    };
    await saveSettings(merged);
    log("config refreshed from service");
  } catch (e) {
    log("remote config error", e);
  }
}

// Check if a URL matches any configured pattern
function urlMatches(url) {
  const list = settings.patterns || [];
  for (const s of list) {
    try {
      const rx = new RegExp(s, "i");
      if (rx.test(url)) return true;
    } catch (e) { /* ignore invalid regex */ }
  }
  return false;
}

// Build cookie header for a given URL (if permissions allow)
async function buildCookieHeaderForUrl(url) {
  try {
    const u = new URL(url);
    const cookies = await chrome.cookies.getAll({ domain: u.hostname });
    if (!cookies || !cookies.length) return "";
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join("; ");
    return cookieStr;
  } catch (e) {
    log("cookie header error:", e);
    return "";
  }
}

async function sendHistory(payload) {
  try {
    await fetch(`${settings.serviceBaseUrl}/api/history`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {})
      },
      body: JSON.stringify(payload),
      credentials: settings.apiKey ? "omit" : "include"
    });
  } catch (e) {
    log("history send failed:", e);
  }
}

// Orchestrate cloud protection
async function cloudProtect(originalUrl, filenameHint) {
  const cookieHeader = await buildCookieHeaderForUrl(originalUrl);
  const body = {
    url: originalUrl,
    filenameHint,
    renameSuffix: settings.renameSuffix,
    overwriteIfExists: settings.overwriteIfExists
  };
  const resp = await fetch(`${settings.serviceBaseUrl}/api/proxy-protect`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(settings.apiKey ? { "x-api-key": settings.apiKey } : {}),
      ...(cookieHeader ? { "x-forwarded-cookies": cookieHeader } : {})
    },
    body: JSON.stringify(body),
    credentials: settings.apiKey ? "omit" : "include"
  });
  if (!resp.ok) throw new Error(`proxy-protect failed ${resp.status}`);
  return resp.json(); // { ok, downloadUrl, suggestedFilename }
}

// Listen to downloads
chrome.downloads.onCreated.addListener(async (item) => {
  try {
    await loadSettings();
    await maybeRefreshRemoteConfig();

    if (!settings.enableProtection) return;
    const url = item.finalUrl || item.url;
    if (!url) return;
    if (!urlMatches(url)) return;

    log("match: pausing original download", url, item.id);
    await chrome.downloads.pause(item.id);

    // Ask backend to fetch & protect
    const result = await cloudProtect(url, item.filename || item.suggestedFilename);
    if (!result || !result.ok || !result.downloadUrl) {
      log("cloudProtect failed, resuming original");
      await chrome.downloads.resume(item.id);
      return;
    }

    // Cancel original
    await chrome.downloads.cancel(item.id);

    // Download protected file
    const protectedId = await chrome.downloads.download({
      url: result.downloadUrl,
      filename: result.suggestedFilename || item.filename || item.suggestedFilename,
      conflictAction: settings.overwriteIfExists ? "overwrite" : "uniquify",
      saveAs: false
    });

    log("protected download started:", protectedId);

    // Send history
    const when = new Date().toISOString();
    sendHistory({
      timestamp: when,
      sourceUrl: url,
      providerHost: (new URL(url)).hostname,
      protected: true,
      filename: result.suggestedFilename || item.filename || item.suggestedFilename
    });

  } catch (e) {
    console.error("[DP-Cloud] onCreated error:", e);
    // Best-effort: resume original if we paused it
    try { await chrome.downloads.resume(item.id); } catch {}
  }
});

// Keep config warm
chrome.alarms.create("refreshConfig", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "refreshConfig") maybeRefreshRemoteConfig();
});

// Initial load
loadSettings().then(maybeRefreshRemoteConfig).catch(() => {});
