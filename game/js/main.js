// ESP Racer - entry point: renderer, game states, menus and controller setup.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GameAudio } from './audio.js';
import { CameraRig } from './camera.js';
import { Effects } from './effects.js';
import { Hud, formatTime } from './hud.js';
import { InputManager } from './input/controller.js';
import { SerialTransport } from './input/serial.js';
import { Race } from './race.js';
import { CAR_COLORS, saveSettings, settings } from './settings.js';
import { Menus, toast } from './ui.js';
import { TRACKS } from './world/tracks.js';

// ---------------------------------------------------------------------------
// Renderer and post-processing
// ---------------------------------------------------------------------------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 6000);

let composer, bloomPass;
function buildComposer() {
  const q = settings.graphics.quality;
  const ratio = Math.min(devicePixelRatio, { high: 2, medium: 1.25, low: 1 }[q]);
  renderer.setPixelRatio(ratio);
  renderer.setSize(innerWidth, innerHeight, false);
  composer?.dispose();
  const target = new THREE.WebGLRenderTarget(innerWidth * ratio, innerHeight * ratio, {
    type: THREE.HalfFloatType,
    samples: { high: 4, medium: 2, low: 0 }[q],
  });
  composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(ratio);
  composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.55, 0.82);
  bloomPass.enabled = settings.graphics.bloom;
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  effects.setViewportHeight(innerHeight * ratio);
}

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  composer.setSize(innerWidth, innerHeight);
  effects.setViewportHeight(innerHeight * renderer.getPixelRatio());
}

// ---------------------------------------------------------------------------
// Game objects
// ---------------------------------------------------------------------------
const input = new InputManager();
const audio = new GameAudio();
audio.volume = settings.audio.volume;
const hud = new Hud();
const effects = new Effects(scene);
const rig = new CameraRig(camera);
const race = new Race({ scene, renderer, effects, audio, hud, camera: rig });
buildComposer();
addEventListener('resize', resize);
// Handy for debugging from the browser console: __game.race.player etc.
window.__game = { race, input, settings };

// state: 'menu' | 'countdown' | 'racing' | 'paused' | 'finished' | 'results' | 'calibrate'
let state = 'menu';
let mode = 'race';

function buildWorld() {
  race.build({
    trackIndex: settings.race.track,
    time: settings.race.time,
    laps: settings.race.laps,
    opponents: settings.race.opponents,
    mode,
    colorIndex: settings.car.color,
    quality: settings.graphics.quality,
  });
  renderer.toneMappingExposure = race.timeCfg.exposure;
  bloomPass.strength = race.timeCfg.bloom;
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------
const menus = new Menus({
  onAction: handleAction,
  onChange: handleSettingChange,
  onNavigate: () => audio.blip(),
});

function handleSettingChange(key, value) {
  if (key === 'race.track' || key === 'race.time' || key === 'race.opponents') buildWorld();
  else if (key === 'car.color') race.setPlayerColor(CAR_COLORS[value].hex);
  else if (key === 'graphics.quality') {
    buildComposer();
    buildWorld();
  } else if (key === 'graphics.bloom') bloomPass.enabled = value;
  else if (key === 'audio.volume') audio.setVolume(value);
  else if (key === 'graphics.showFps') document.getElementById('fps').textContent = '';
}

async function handleAction(action) {
  switch (action) {
    case 'mode-race':
    case 'mode-trial':
      mode = action === 'mode-race' ? 'race' : 'trial';
      document.getElementById('setup-title').textContent = mode === 'race' ? 'Race setup' : 'Time trial';
      document.getElementById('sel-opponents').classList.toggle('hidden', mode !== 'race');
      buildWorld();
      menus.show('screen-setup');
      break;
    case 'start-race':
      startRace();
      break;
    case 'open-controller':
      menus.show('screen-controller');
      refreshControllerScreen();
      break;
    case 'open-settings':
      menus.show('screen-settings');
      break;
    case 'open-help':
      menus.show('screen-help');
      break;
    case 'connect-usb':
      await connectUsb();
      break;
    case 'connect-wifi':
      await connectWifi();
      break;
    case 'disconnect':
      await input.disconnect();
      break;
    case 'reconnect':
      await reconnect();
      break;
    case 'open-flasher':
      await input.disconnect(); // the flasher needs the USB port
      window.open('flash/', '_blank');
      break;
    case 'wifi-apply':
      await applyWifiSetup();
      break;
    case 'calibrate':
      startCalibration();
      break;
    case 'reset-records':
      settings.records = {};
      saveSettings();
      toast('Best laps cleared');
      break;
    case 'resume':
      resume();
      break;
    case 'restart':
      menus.hide();
      race.restart();
      state = 'countdown';
      hud.show(true);
      break;
    case 'quit':
      quitToMenu();
      break;
    case 'reset-car':
      race.player.respawn();
      resume();
      break;
  }
}

function startRace() {
  buildWorld();
  menus.hide();
  hud.show(true);
  hud.el.posPanel.classList.toggle('hidden', mode !== 'race');
  race.startCountdown();
  state = 'countdown';
}

function pause() {
  state = 'paused';
  menus.show('screen-pause', { reset: true });
  refreshPauseStatus();
}

function resume() {
  menus.hide();
  state = race.state === 'countdown' ? 'countdown' : race.state === 'finished' ? 'finished' : 'racing';
}

function quitToMenu() {
  hud.show(false);
  hud.countdown('');
  buildWorld();
  state = 'menu';
  menus.show('screen-title', { reset: true });
}

function showResults() {
  state = 'results';
  hud.show(false);
  const table = document.getElementById('results-table');
  const rows = race.standings();
  const trackId = TRACKS[settings.race.track].id;
  const record = settings.records[trackId];
  if (mode === 'race') {
    const pos = race.positionOf(race.player);
    document.getElementById('results-title').textContent = pos === 1 ? 'Victory!' : `Finished P${pos}`;
    table.innerHTML =
      '<tr><th>POS</th><th>DRIVER</th><th>TIME</th><th>BEST LAP</th></tr>' +
      rows
        .map((c, i) => {
          const time = c.finished ? formatTime(c.finishTime) : 'still racing';
          return `<tr class="${c === race.player ? 'me' : ''}"><td>${i + 1}</td><td><span class="swatch" style="background:${c.cssColor}"></span>${c.name}</td><td>${time}</td><td>${formatTime(c.bestLap)}</td></tr>`;
        })
        .join('');
  } else {
    document.getElementById('results-title').textContent = 'Time trial complete';
    table.innerHTML =
      '<tr><th>LAP</th><th>TIME</th></tr>' +
      race.player.lapTimes.map((t, i) => `<tr class="${t === race.player.bestLap ? 'me' : ''}"><td>${i + 1}</td><td>${formatTime(t)}</td></tr>`).join('') +
      `<tr><td>Track record</td><td>${formatTime(record)}</td></tr>`;
  }
  menus.show('screen-results', { reset: true });
}

function handleRaceEvents() {
  for (const ev of race.events) {
    if (ev.type === 'lap') {
      const trackId = TRACKS[settings.race.track].id;
      const record = settings.records[trackId];
      if (record == null || ev.lapMs < record) {
        settings.records[trackId] = ev.lapMs;
        saveSettings();
        hud.message(`NEW RECORD ${formatTime(ev.lapMs)}`, 2.5);
        audio.beep(1320, 0.3, 0.2);
      } else if (ev.lapsDone === settings.race.laps - 1) {
        hud.message('FINAL LAP', 2);
      } else if (ev.lapsDone < settings.race.laps) {
        hud.message(`LAP ${ev.lapsDone + 1}`, 1.5);
      }
    } else if (ev.type === 'finish') {
      state = 'finished';
      hud.message(mode === 'race' ? (ev.position === 1 ? 'YOU WIN!' : `P${ev.position}`) : 'FINISH', 3);
      audio.beep(880, 0.6, 0.25);
    } else if (ev.type === 'results') {
      showResults();
    }
  }
  race.events.length = 0;
}

// ---------------------------------------------------------------------------
// Controller connection
// ---------------------------------------------------------------------------
const chip = document.getElementById('conn-chip');
const chipText = document.getElementById('conn-chip-text');
const chipSteer = document.getElementById('chip-steer');
const wifiHostInput = document.getElementById('wifi-host');
wifiHostInput.value = settings.conn.wifiHost;

async function connectUsb() {
  try {
    await input.connectUsb();
  } catch (err) {
    if (err.name === 'NotFoundError') return; // user closed the port picker
    toast(err.message, { error: true, ms: 6000 });
  }
}

async function connectWifi() {
  const host = wifiHostInput.value.trim() || '192.168.4.1';
  toast(`Connecting to ${host}...`);
  try {
    await input.connectWifi(host);
  } catch (err) {
    toast(err.message, { error: true, ms: 6000 });
  }
}

// Reconnects over the last-used link (USB or WiFi), e.g. from the pause menu after a cable bump.
async function reconnect() {
  const kind = input.connected ? input.kind : settings.conn.last;
  if (kind === 'wifi') {
    wifiHostInput.value = settings.conn.wifiHost;
    await connectWifi();
    return;
  }
  if (kind !== 'usb') {
    toast('No controller used yet: connect it once from the Controller menu.', { error: true });
    return;
  }
  try {
    // Reuse a port the browser already granted; only show the picker if there is none.
    if (!(await input.connectUsb({ silent: true }))) await connectUsb();
  } catch (err) {
    toast(err.message, { error: true, ms: 6000 });
  }
}

function refreshPauseStatus() {
  const el = document.getElementById('pause-conn');
  if (input.connected) {
    el.textContent = `Controller connected via ${input.kind === 'usb' ? 'USB' : 'WiFi'}`;
    el.className = 'status-line ok';
  } else {
    el.textContent = 'Controller not connected (keyboard active)';
    el.className = 'status-line warn';
  }
}

input.on('status', ({ connected, message }) => {
  toast(message, { error: !connected && message !== 'Disconnected' });
  refreshControllerScreen();
  refreshPauseStatus();
});
input.on('info', (info) => {
  if (input.kind === 'usb' && info.ip && info.wifiState !== 'off') {
    wifiHostInput.value = info.ip;
  }
  refreshControllerScreen();
});
input.on('reply', (msg) => {
  if (msg.type === 'error') toast(`Controller: ${msg.text}`, { error: true });
});
input.on('log', (text) => {
  if (text.startsWith('WiFi connected') || text.startsWith('WiFi join failed')) {
    toast(text);
    input.send('INFO');
  }
});

function refreshControllerScreen() {
  const status = document.getElementById('conn-status');
  const info = input.info;
  if (input.connected) {
    status.textContent = `Connected via ${input.kind === 'usb' ? 'USB' : 'WiFi'}`;
    status.className = 'status-line ok';
  } else {
    status.textContent = 'Not connected (keyboard active)';
    status.className = 'status-line warn';
  }
  const lines = [];
  if (info) {
    lines.push(`Firmware ${info.fw} · Tilt sensor: ${info.sensor}${info.sensorOk ? '' : ' (NOT FOUND - check wiring)'}`);
    const wifiDesc = { off: 'off', ap: `own hotspot "${info.apSsid}" (password ${info.apPass})`, sta: `joined "${info.staSsid}"`, connecting: `joining "${info.staSsid}"...`, 'ap-fallback': `could not join home WiFi, hotspot "${info.apSsid}" active` }[info.wifiState] ?? info.wifiState;
    lines.push(`WiFi: ${wifiDesc}${info.ip ? ` · IP ${info.ip}` : ''}`);
  } else if (!SerialTransport.supported()) {
    lines.push('This browser has no USB serial support. Use Chrome or Edge, or connect over WiFi.');
  }
  document.getElementById('device-info').textContent = lines.join('\n');
  document.getElementById('device-info').style.whiteSpace = 'pre-line';
}

async function applyWifiSetup() {
  if (input.kind !== 'usb') {
    toast('Connect the controller with USB first to change its WiFi.', { error: true });
    return;
  }
  const mode = settings.wifiSetup.mode;
  const ssid = document.getElementById('wifi-ssid').value.trim();
  const pass = document.getElementById('wifi-pass').value;
  if (mode === 'STA' && !ssid) {
    toast('Enter your home WiFi name first.', { error: true });
    return;
  }
  const cmds = [`WIFI MODE ${mode}`];
  if (mode === 'STA') {
    cmds.push(`WIFI SSID ${ssid}`);
    if (pass) cmds.push(`WIFI PASS ${pass}`);
  }
  cmds.push('WIFI APPLY');
  for (const c of cmds) {
    await input.send(c);
    await new Promise((r) => setTimeout(r, 120));
  }
  document.getElementById('wifi-pass').value = '';
  toast(mode === 'STA' ? 'Sent. The controller is joining your WiFi; its IP will appear here.' : 'WiFi settings sent to the controller.');
}

function updateChip() {
  const kind = input.kind;
  const stale = input.connected && !input.deviceActive;
  chip.className = stale ? `${kind} stale` : kind;
  chipText.textContent = kind === 'keyboard' ? 'Keyboard' : `${kind === 'usb' ? 'USB' : 'WiFi'}${stale ? ' · no data' : ''}`;
  const s = input.drive.steer;
  chipSteer.style.left = s < 0 ? `${50 + s * 50}%` : '50%';
  chipSteer.style.width = `${Math.abs(s) * 50}%`;
}

function setBar(id, value, centered = false) {
  const el = document.getElementById(id);
  if (centered) {
    const v = Math.max(-1, Math.min(1, value));
    el.style.left = v < 0 ? `${50 + v * 50}%` : '50%';
    el.style.width = `${Math.abs(v) * 50}%`;
  } else {
    el.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
  }
}

function updateLiveTest() {
  setBar('lv-steer', input.drive.steer, true);
  setBar('lv-gas', input.drive.throttle);
  setBar('lv-brake', input.drive.brake);
  document.getElementById('lv-btn').classList.toggle('on', input.drive.nitro);
  const d = input.device;
  document.getElementById('lv-raw').textContent = input.connected
    ? `roll ${d.roll.toFixed(1)}° pitch ${d.pitch.toFixed(1)}° stick ${d.joy.toFixed(2)}`
    : '';
}

// ---------------------------------------------------------------------------
// Guided calibration
// ---------------------------------------------------------------------------
const calib = { step: 0, level: null, stickHold: 0 };
const CALIB_TEXT = [
  'Hold the controller <b>level</b>, the way you will hold it while driving. Then press the stick button.',
  'Now tilt the controller fully to the <b>RIGHT</b>, like turning a steering wheel right. Then press the stick button.',
  'Push the stick <b>UP</b> (gas) and hold it for a moment...',
  'Calibration saved! Press the button to go back.',
];

function startCalibration() {
  if (!input.deviceActive) {
    toast('Connect the controller first (USB or WiFi).', { error: true });
    return;
  }
  calib.step = 0;
  calib.stickHold = 0;
  state = 'calibrate';
  menus.show('screen-calibrate');
  document.getElementById('calib-text').innerHTML = CALIB_TEXT[0];
}

function calibrationEvent(ev) {
  const d = input.device;
  if (ev === 'back') {
    state = 'menu';
    menus.back();
    return;
  }
  if (ev !== 'select') return;
  if (calib.step === 0) {
    calib.level = { roll: d.roll, pitch: d.pitch };
    calib.step = 1;
  } else if (calib.step === 1) {
    const dRoll = d.roll - calib.level.roll;
    const dPitch = d.pitch - calib.level.pitch;
    const useRoll = Math.abs(dRoll) >= Math.abs(dPitch);
    const delta = useRoll ? dRoll : dPitch;
    if (Math.abs(delta) < 8) {
      toast('Tilt more: the controller barely moved.', { error: true });
      return;
    }
    const c = settings.controls;
    c.steerAxis = useRoll ? 'roll' : 'pitch';
    c.invertSteer = delta < 0;
    c.rollOffset = calib.level.roll;
    c.pitchOffset = calib.level.pitch;
    const range = Math.round((Math.abs(delta) * 0.85) / 5) * 5;
    c.tiltRange = Math.max(15, Math.min(60, range));
    saveSettings();
    calib.step = 2;
  } else if (calib.step === 3) {
    state = 'menu';
    menus.back();
    menus.refresh();
    return;
  }
  audio.blip();
  document.getElementById('calib-text').innerHTML = CALIB_TEXT[calib.step];
}

function updateCalibration(dt) {
  const d = input.device;
  setBar('cal-roll', (d.roll - (calib.level?.roll ?? 0)) / 45, true);
  setBar('cal-pitch', (d.pitch - (calib.level?.pitch ?? 0)) / 45, true);
  setBar('cal-joy', d.joy, true);
  if (calib.step === 2) {
    calib.stickHold = Math.abs(d.joy) > 0.6 ? calib.stickHold + dt : 0;
    if (calib.stickHold > 0.6) {
      settings.controls.invertThrottle = d.joy < 0;
      saveSettings();
      calib.step = 3;
      audio.blip();
      document.getElementById('calib-text').innerHTML = CALIB_TEXT[3];
    }
  }
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();
const fpsEl = document.getElementById('fps');
let fpsFrames = 0, fpsTime = 0;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  const inRace = state === 'countdown' || state === 'racing' || state === 'finished';
  const events = input.update(dt, inRace ? 'race' : 'menu');

  if (state === 'calibrate') {
    for (const ev of events) calibrationEvent(ev);
    updateCalibration(dt);
  } else if (inRace) {
    for (const ev of events) {
      if (ev === 'pause') pause();
      else if (ev === 'camera') rig.nextMode();
      else if (ev === 'reset' && state === 'racing') race.player.respawn();
    }
  } else {
    for (const ev of events) {
      if (state === 'paused' && ev === 'back') resume();
      else menus.handle(ev);
    }
  }

  if (state !== 'paused') race.update(dt, input.drive);
  handleRaceEvents();

  const player = race.player;
  if (player) {
    const showroom = state === 'menu' || state === 'calibrate';
    rig.update(dt, player, { orbit: showroom, nitro: player.nitroActive });
    race.env.update(camera, rig.look);
    audio.updateCar(player, inRace);

    if (inRace) {
      hud.set('lap', race.playerLapLabel);
      const lapTime = race.state === 'countdown' ? 0 : race.raceTime - player.lapStart;
      hud.set('time', formatTime(player.finished ? player.lapTimes.at(-1) : lapTime));
      hud.set('last', formatTime(player.lapTimes.at(-1)));
      const record = settings.records[TRACKS[settings.race.track].id];
      hud.set('best', formatTime(player.bestLap ?? record));
      hud.set('pos', String(race.positionOf(player)));
      hud.set('posTotal', `/${race.cars.length}`);
      hud.drawSpeedo(player);
      hud.drawMinimap(race.cars, player);
      hud.update(dt);
    }
  }

  if (menus.screenId === 'screen-controller') updateLiveTest();
  updateChip();
  composer.render(dt);

  if (settings.graphics.showFps) {
    fpsFrames++;
    fpsTime += dt;
    if (fpsTime > 0.5) {
      fpsEl.textContent = `${Math.round(fpsFrames / fpsTime)} FPS`;
      fpsFrames = 0;
      fpsTime = 0;
    }
  }
  requestAnimationFrame(frame);
}

// Audio needs a user gesture; any click or key unlocks it.
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => audio.unlock());

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  buildWorld();
  menus.show('screen-title', { reset: true });
  document.getElementById('loading').classList.add('done');
  updateTitleHint();
  input.on('status', updateTitleHint);
  requestAnimationFrame(frame);

  if (settings.conn.auto) {
    try {
      if (settings.conn.last === 'usb') await input.connectUsb({ silent: true });
      else if (settings.conn.last === 'wifi') await input.connectWifi(settings.conn.wifiHost);
    } catch {
      // Controller not plugged in / not reachable: keyboard still works.
    }
  }
}

function updateTitleHint() {
  document.getElementById('title-hint').textContent = input.connected
    ? `Controller connected via ${input.kind === 'usb' ? 'USB' : 'WiFi'}. Stick to move, click to select.`
    : 'No controller connected: open Controller to connect, or play with the keyboard.';
}

boot();
