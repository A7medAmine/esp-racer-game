// Persistent game settings (stored in the browser's localStorage).
import { TRACKS } from './world/tracks.js';

const STORAGE_KEY = 'espracer.settings.v1';

export const CAR_COLORS = [
  { name: 'Racing Red', hex: 0xd8141c },
  { name: 'Electric Blue', hex: 0x1356e0 },
  { name: 'Volt Yellow', hex: 0xf2c200 },
  { name: 'Pearl White', hex: 0xe8ecef },
  { name: 'Toxic Green', hex: 0x22b14c },
  { name: 'Midnight Black', hex: 0x15161a },
  { name: 'Sunset Orange', hex: 0xff6a13 },
  { name: 'Royal Purple', hex: 0x6a2bd9 },
];

// Option lists for every selector in the menus, keyed by setting path.
export const OPTIONS = {
  'race.track': TRACKS.map((t, i) => ({ value: i, label: t.name })),
  'race.time': [
    { value: 'day', label: 'Day' },
    { value: 'sunset', label: 'Sunset' },
    { value: 'night', label: 'Night' },
  ],
  'race.laps': [1, 2, 3, 4, 5, 7, 10].map((n) => ({ value: n, label: String(n) })),
  'race.opponents': [0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) })),
  'race.difficulty': [
    { value: 'easy', label: 'Easy' },
    { value: 'normal', label: 'Normal' },
    { value: 'hard', label: 'Hard' },
  ],
  'car.color': CAR_COLORS.map((c, i) => ({ value: i, label: c.name })),
  'conn.auto': onOff(),
  'controls.steerAxis': [
    { value: 'roll', label: 'Roll (side tilt)' },
    { value: 'pitch', label: 'Pitch (fwd tilt)' },
  ],
  'controls.layout': [
    { value: 'joystick', label: 'Joystick' },
    { value: 'pedals', label: 'Paddles' },
  ],
  'controls.haptics': [
    { value: 0, label: 'Off' },
    { value: 0.6, label: 'Low' },
    { value: 1, label: 'High' },
  ],
  'controls.invertSteer': onOff(),
  'controls.invertThrottle': onOff(),
  'controls.tiltRange': [15, 20, 25, 30, 35, 40, 50, 60].map((n) => ({ value: n, label: `${n}°` })),
  'controls.steerCurve': [
    { value: 1.0, label: 'Linear' },
    { value: 1.4, label: 'Smooth' },
    { value: 1.9, label: 'Precise center' },
  ],
  'graphics.quality': [
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
  ],
  'graphics.bloom': onOff(),
  'graphics.showFps': onOff(),
  'audio.volume': [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((v) => ({
    value: v,
    label: `${Math.round(v * 100)}%`,
  })),
  'audio.voice': [
    { value: 'male', label: 'Male' },
    { value: 'female', label: 'Female' },
    { value: 'off', label: 'Off' },
  ],
  'wifiSetup.mode': [
    { value: 'AP', label: 'Own hotspot' },
    { value: 'STA', label: 'Home WiFi' },
    { value: 'OFF', label: 'Off (USB only)' },
  ],
};

function onOff() {
  return [
    { value: false, label: 'Off' },
    { value: true, label: 'On' },
  ];
}

const DEFAULTS = {
  race: { track: 0, time: 'sunset', laps: 3, opponents: 3, difficulty: 'normal' },
  car: { color: 0 },
  conn: { auto: true, wifiHost: '192.168.4.1', last: 'none' },
  controls: {
    // 'joystick': stick for gas/brake (paddles also work if wired).
    // 'pedals': gas/brake paddles only, the stick input is ignored (A0 floats when no stick is wired).
    layout: 'joystick',
    haptics: 1,
    steerAxis: 'roll',
    invertSteer: false,
    invertThrottle: false,
    tiltRange: 30,
    steerCurve: 1.4,
    rollOffset: 0,
    pitchOffset: 0,
  },
  graphics: { quality: 'high', bloom: true, showFps: false },
  audio: { volume: 0.6, voice: 'male' },
  wifiSetup: { mode: 'AP' },
  records: {},
};

function merge(base, extra) {
  const out = structuredClone(base);
  if (!extra || typeof extra !== 'object') return out;
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object') out[k] = merge(out[k], v);
    else out[k] = v;
  }
  return out;
}

function load() {
  try {
    return merge(DEFAULTS, JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage blocked (private mode): settings simply won't persist.
  }
}

export function getSetting(path) {
  return path.split('.').reduce((o, k) => o?.[k], settings);
}

export function setSetting(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const obj = keys.reduce((o, k) => (o[k] ??= {}), settings);
  obj[last] = value;
  saveSettings();
}
