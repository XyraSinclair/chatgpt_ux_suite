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
  soundNotification: false,
  shortcutPrev: 'Alt+E',
  shortcutNext: 'Alt+D'
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

