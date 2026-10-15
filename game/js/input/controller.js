// Unified input: ESP controller (USB or WiFi) + keyboard.
// Produces driving input every frame and menu navigation events.
import { settings, saveSettings } from '../settings.js';
import { parseLine } from './protocol.js';
import { SerialTransport } from './serial.js';
import { WifiTransport } from './wifi.js';

const STALE_MS = 500;
const DOUBLE_TAP_MS = 380;
const MENU_JOY_THRESHOLD = 0.55;
const MENU_TILT_THRESHOLD = 0.5;
// Paddles are on/off buttons; ramping them makes a press feel like a quick pedal push, not a jolt.
const PEDAL_PRESS_RATE = 8; // full travel in 0.125 s
const PEDAL_RELEASE_RATE = 16;

class Emitter {
  constructor() {
    this.handlers = {};
  }
  on(name, fn) {
    (this.handlers[name] ??= []).push(fn);
  }
  emit(name, ...args) {
    for (const fn of this.handlers[name] ?? []) fn(...args);
  }
}

export class InputManager extends Emitter {
  constructor() {
    super();
    this.transport = null;
    this.device = { roll: 0, pitch: 0, joy: 0, button: false, gas: false, brake: false, sensorOk: true, lastData: 0, frames: 0 };
    this.info = null;
    this.keys = new Set();
    this.queue = []; // pending discrete events: 'press' | 'release' | key names
    this.lastPressAt = 0;
    this.kbSteer = 0;
    this.navRepeat = {};
    for (const d of ['up', 'down', 'left', 'right']) this.navRepeat[d] = { held: false, timer: 0 };
    this.pedal = { gas: 0, brake: 0 }; // ramped paddle values 0..1
    this.drive = { steer: 0, throttle: 0, brake: 0, nitro: false };
    this.setupKeyboard();
  }

  // ------------------------------------------------------------------ transports
  get connected() {
    return !!this.transport;
  }
  get deviceActive() {
    return this.connected && performance.now() - this.device.lastData < STALE_MS;
  }
  get kind() {
    return this.transport?.kind ?? 'keyboard';
  }
  // Firmware 1.1+ reports what it supports; older firmware has no gas/brake paddles or vibration.
  has(cap) {
    return !!this.info?.caps?.includes(cap);
  }
  get pedalLayout() {
    return settings.controls.layout === 'pedals';
  }

  makeHandlers() {
    return {
      onLine: (line) => this.handleLine(line),
      onClose: (reason) => {
        this.transport = null;
        this.info = null;
        this.emit('status', { connected: false, message: reason });
      },
    };
  }

  async connectUsb({ silent = false } = {}) {
    if (!SerialTransport.supported()) {
      throw new Error('USB needs Chrome or Edge on a desktop computer (Web Serial API).');
    }
    await this.disconnect();
    let port;
    if (silent) {
      [port] = await SerialTransport.grantedPorts();
      if (!port) return false;
    }
    const t = new SerialTransport(this.makeHandlers());
    await t.connect(port);
    this.attach(t, 'USB');
    settings.conn.last = 'usb';
    saveSettings();
    return true;
  }

  async connectWifi(host) {
    await this.disconnect();
    const t = new WifiTransport(this.makeHandlers());
    await t.connect(host);
    this.attach(t, `WiFi ${host}`);
    settings.conn.last = 'wifi';
    settings.conn.wifiHost = host;
    saveSettings();
  }

  attach(t, label) {
    this.transport = t;
    this.device.lastData = 0;
    this.emit('status', { connected: true, message: `Connected via ${label}` });
    // Ask for device info a few times: the board may still be booting after the USB reset.
    for (const ms of [300, 1500, 3500]) setTimeout(() => this.send('INFO'), ms);
  }

  async disconnect() {
    const t = this.transport;
    if (!t) return;
    this.transport = null;
    await t.disconnect();
    this.info = null;
    this.emit('status', { connected: false, message: 'Disconnected' });
  }

  async send(cmd) {
    try {
      return (await this.transport?.send(cmd)) ?? false;
    } catch {
      return false;
    }
  }

  handleLine(line) {
    const msg = parseLine(line);
    if (!msg) return;
    if (msg.type === 'data') {
      const d = this.device;
      const wasPressed = d.button;
      d.roll = msg.roll;
      d.pitch = msg.pitch;
      d.joy = msg.joy;
      d.button = msg.button;
      d.gas = msg.gas;
      d.brake = msg.brake;
      d.sensorOk = msg.sensorOk;
      d.lastData = performance.now();
      d.frames++;
      if (msg.button && !wasPressed) this.queue.push('press');
    } else if (msg.type === 'info') {
      this.info = msg.info;
      this.emit('info', msg.info);
    } else if (msg.type === 'ok' || msg.type === 'error') {
      this.emit('reply', msg);
    } else if (msg.type === 'log') {
      this.emit('log', msg.text);
    }
  }

  // ------------------------------------------------------------------ keyboard
  setupKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      if (!e.repeat) this.keys.add(k);
      this.queue.push({ key: k, repeat: e.repeat });
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  key(...names) {
    return names.some((n) => this.keys.has(n));
  }

  // ------------------------------------------------------------------ mapping
  // Steering from tilt, -1 (left) .. 1 (right), after calibration and tuning.
  tiltSteer() {
    const c = settings.controls;
    const d = this.device;
    let angle = c.steerAxis === 'pitch' ? d.pitch - c.pitchOffset : d.roll - c.rollOffset;
    if (c.invertSteer) angle = -angle;
    const deadzone = 2;
    const mag = Math.min(1, Math.max(0, (Math.abs(angle) - deadzone) / (c.tiltRange - deadzone)));
    return Math.sign(angle) * Math.pow(mag, c.steerCurve);
  }

  stick() {
    if (this.pedalLayout) return 0; // no stick wired: A0 floats and reads noise
    return settings.controls.invertThrottle ? -this.device.joy : this.device.joy;
  }

  updatePedals(dt, active) {
    for (const k of ['gas', 'brake']) {
      const target = active && this.device[k] ? 1 : 0;
      const rate = target > this.pedal[k] ? PEDAL_PRESS_RATE : PEDAL_RELEASE_RATE;
      this.pedal[k] += Math.max(-rate * dt, Math.min(rate * dt, target - this.pedal[k]));
    }
  }

  // Call once per frame. `mode` is 'menu' or 'race'. Returns discrete events.
  update(dt, mode) {
    const events = [];
    const active = this.deviceActive;
    const now = performance.now();

    // Discrete events from the queue.
    for (const ev of this.queue) {
      if (ev === 'press') {
        if (mode === 'race') {
          if (now - this.lastPressAt < DOUBLE_TAP_MS) {
            events.push('pause');
            this.lastPressAt = 0;
            continue;
          }
          this.lastPressAt = now;
        } else {
          events.push('select');
        }
        continue;
      }
      const k = ev.key;
      if (mode === 'race') {
        if ((k === 'escape' || k === 'p') && !ev.repeat) events.push('pause');
        else if (k === 'c' && !ev.repeat) events.push('camera');
        else if (k === 'r' && !ev.repeat) events.push('reset');
      } else {
        if (k === 'arrowup' || k === 'w') events.push('up');
        else if (k === 'arrowdown' || k === 's') events.push('down');
        else if (k === 'arrowleft' || k === 'a') events.push('left');
        else if (k === 'arrowright' || k === 'd') events.push('right');
        else if ((k === 'enter' || k === ' ') && !ev.repeat) events.push('select');
        else if ((k === 'escape' || k === 'backspace') && !ev.repeat) events.push('back');
      }
    }
    this.queue.length = 0;

    // Analog menu navigation with auto-repeat. Paddles: brake = previous item, gas = next item.
    if (mode !== 'race' && active) {
      const stick = this.stick();
      const tilt = this.tiltSteer();
      this.navAxis('up', stick > MENU_JOY_THRESHOLD || this.device.brake, dt, events);
      this.navAxis('down', stick < -MENU_JOY_THRESHOLD || this.device.gas, dt, events);
      this.navAxis('left', tilt < -MENU_TILT_THRESHOLD, dt, events);
      this.navAxis('right', tilt > MENU_TILT_THRESHOLD, dt, events);
    }

    // Driving input.
    const kbTarget = (this.key('arrowright', 'd') ? 1 : 0) - (this.key('arrowleft', 'a') ? 1 : 0);
    const rate = kbTarget === 0 ? 6 : Math.sign(kbTarget) !== Math.sign(this.kbSteer) ? 7 : 3.2;
    this.kbSteer += Math.max(-rate * dt, Math.min(rate * dt, kbTarget - this.kbSteer));

    const devSteer = active ? this.tiltSteer() : 0;
    const devStick = active ? this.stick() : 0;
    this.updatePedals(dt, active);
    const kbGas = this.key('arrowup', 'w') ? 1 : 0;
    const kbBrake = this.key('arrowdown', 's') ? 1 : 0;

    // Stick and paddles are merged: unwired paddle pins always read "not pressed".
    this.drive.steer = Math.max(-1, Math.min(1, devSteer + this.kbSteer));
    this.drive.throttle = Math.max(kbGas, Math.max(0, devStick), this.pedal.gas);
    this.drive.brake = Math.max(kbBrake, Math.max(0, -devStick), this.pedal.brake);
    this.drive.nitro = this.key(' ', 'shift') || (active && this.device.button);
    return events;
  }

  // Fires once when the axis is pushed, then repeats while held.
  navAxis(dir, held, dt, events) {
    const s = this.navRepeat[dir];
    if (!held) {
      s.held = false;
      return;
    }
    if (!s.held) {
      s.held = true;
      s.timer = 0.42;
      events.push(dir);
      return;
    }
    s.timer -= dt;
    if (s.timer <= 0) {
      events.push(dir);
      s.timer = 0.16;
    }
  }
}
