/**
 * ChatGPT UX Suite - definitions shared by the content script, popup, and
 * service worker. Plain globals: every context loads this file first.
 */
'use strict';

const DEFAULT_SETTINGS = {
  tokenCounter: true,
  promptNavigator: true,
  responseStyling: true,
  sessionTracker: true,
  contextCollector: true,
  chatTimestamps: false,
  soundNotification: false
};

// Chime presets: low frequencies, consonant intervals, reduced volume.
const CHIME_PRESETS = {
  aurora: { note1: 98.00, note2: 146.83, duration: 0.6, attack: 0.04, volume: 0.14 }, // G2→D3, ethereal
  ocean: { note1: 98.00, note2: 130.81, duration: 0.6, attack: 0.05, volume: 0.14 }, // G2→C3, rolling
  velvet: { note1: 164.81, note2: 130.81, duration: 0.55, attack: 0.04, volume: 0.16 }, // E3→C3, gentle
  chime: { note1: 130.81, note2: 196.00, duration: 0.55, attack: 0.03, volume: 0.18 } // C3→G3, bright
};
const DEFAULT_CHIME = 'chime';

/** Two-note sine chime with a quiet octave harmonic. */
function playChime(presetName) {
  const preset = CHIME_PRESETS[presetName] || CHIME_PRESETS[DEFAULT_CHIME];
  const vol = preset.volume;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const noteSwitch = now + preset.duration * 0.4;
    [[1, vol], [2, vol * 0.25]].forEach(([multiple, peak]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(preset.note1 * multiple, now);
      osc.frequency.setValueAtTime(preset.note2 * multiple, noteSwitch);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(peak, now + preset.attack);
      gain.gain.exponentialRampToValueAtTime(0.001, now + preset.duration);
      osc.start(now);
      osc.stop(now + preset.duration);
    });
  } catch (e) {
    console.warn('ChatGPT UX Suite: could not play chime', e);
  }
}

// License (Polar) — the content script gates prompt navigation; the popup activates keys.
const POLAR_ORG_ID = 'f88eadc1-f584-4ae6-a6be-b511e014f825';
const FREE_NAVIGATIONS = 30;
const LICENSE_KEY_PREFIX = 'key_';
const BYPASS_LICENSE_KEY = 'DEV_BYPASS';
const BYPASS_KEY_ALIASES = new Set([BYPASS_LICENSE_KEY, 'DEV-BYPASS']);
const LICENSE_STORAGE_KEYS = {
  licenseKey: 'promptNavLicenseKey',
  usageCount: 'promptNavUsageCount',
  licenseValid: 'promptNavLicenseValid',
  lastValidated: 'promptNavLastValidated'
};

/** Accepts a bare key, a "License key: …" line, or a URL carrying the key. */
function normalizeLicenseKey(rawKey) {
  if (typeof rawKey !== 'string') return '';
  let key = rawKey.trim();
  if (!key) return '';
  if (/^https?:\/\//i.test(key)) {
    try {
      const url = new URL(key);
      const fromUrl = url.searchParams.get('license_key') || url.searchParams.get('licenseKey') || url.searchParams.get('key');
      if (fromUrl) key = fromUrl.trim();
    } catch (e) {
      // Malformed URL: fall through with the raw input.
    }
  }
  return key
    .replace(/^(license\s*key|license|key)\s*[:=#-]\s*/i, '')
    .replace(/\s+/g, '');
}

function isBypassLicenseKey(key) {
  return !!key && BYPASS_KEY_ALIASES.has(String(key).trim().toUpperCase());
}

/** The key as given plus its "key_"-prefixed / unprefixed twin. */
function getLicenseCandidates(normalizedKey) {
  const twin = normalizedKey.toLowerCase().startsWith(LICENSE_KEY_PREFIX) && normalizedKey.length > LICENSE_KEY_PREFIX.length
    ? normalizedKey.slice(LICENSE_KEY_PREFIX.length)
    : `${LICENSE_KEY_PREFIX}${normalizedKey}`;
  return [...new Set([normalizedKey, twin].filter(Boolean))];
}

/** @returns {{isValid: boolean, key: string, transientError: boolean}} */
async function validateLicenseWithPolar(rawKey) {
  const normalizedKey = normalizeLicenseKey(rawKey);
  if (!normalizedKey) return { isValid: false, key: '', transientError: false };
  if (isBypassLicenseKey(normalizedKey)) return { isValid: true, key: BYPASS_LICENSE_KEY, transientError: false };

  let transientError = false;
  let definitiveInvalid = false;
  for (const candidate of getLicenseCandidates(normalizedKey)) {
    try {
      const response = await fetch('https://api.polar.sh/v1/customer-portal/license-keys/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: candidate, organization_id: POLAR_ORG_ID })
      });
      if (!response.ok) {
        if (response.status >= 500 || response.status === 429) transientError = true;
        else definitiveInvalid = true;
        continue;
      }
      const data = await response.json();
      if (data.status === 'granted') return { isValid: true, key: candidate, transientError: false };
      definitiveInvalid = true;
    } catch (e) {
      transientError = true;
      console.error('License validation error:', e);
    }
  }
  return { isValid: false, key: normalizedKey, transientError: transientError && !definitiveInvalid };
}
