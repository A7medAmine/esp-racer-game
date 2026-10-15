// Vibration motor on the controller (firmware 1.1+, command `VIB <0-100> <ms>`).
// Short pulses (crash, nitro, countdown) and continuous rumbles (grass, nitro burn)
// are mixed here; the strongest one wins and is sent at most every SEND_GAP seconds.
// Every command carries a duration, so the motor stops by itself if the game stops sending.
import { settings } from '../settings.js';

const SEND_GAP = 0.05; // seconds between commands, keeps the USB/WiFi link quiet
const KEEPALIVE = 0.15; // resend a running effect this often...
const HOLD_MS = 260; // ...asking for a bit longer, so it never gaps
const MIN_STRENGTH = 12; // below this a phone motor doesn't spin up

export class Haptics {
  constructor(input) {
    this.input = input;
    this.pulses = []; // { strength 0..1, time left in seconds }
    this.rumble = 0; // continuous level for this frame, 0..1
    this.sent = 0; // last strength sent, 0..100
    this.sinceSend = 0;
    this.busy = false;
  }

  get available() {
    return this.input.deviceActive && this.input.has('haptics');
  }

  // One-shot buzz. strength 0..1, ms duration.
  pulse(strength, ms) {
    this.pulses.push({ strength, left: ms / 1000 });
  }

  // Continuous rumble, set every frame (0 = none).
  setRumble(strength) {
    this.rumble = Math.max(this.rumble, strength);
  }

  update(dt) {
    let level = this.rumble;
    for (const p of this.pulses) {
      level = Math.max(level, p.strength);
      p.left -= dt;
    }
    this.pulses = this.pulses.filter((p) => p.left > 0);
    this.rumble = 0;
    this.sinceSend += dt;

    if (!this.available) {
      this.sent = 0;
      return;
    }
    let value = Math.round(Math.min(1, level) * settings.controls.haptics * 100);
    if (value > 0) value = Math.max(MIN_STRENGTH, value);

    const changed = Math.abs(value - this.sent) >= 6 || (value === 0) !== (this.sent === 0);
    const due = value > 0 && this.sinceSend >= KEEPALIVE;
    if (this.busy || this.sinceSend < SEND_GAP || !(changed || due)) return;
    this.send(value);
  }

  async send(value) {
    this.busy = true;
    this.sinceSend = 0;
    this.sent = value;
    try {
      await this.input.send(value > 0 ? `VIB ${value} ${HOLD_MS}` : 'VIB 0');
    } finally {
      this.busy = false;
    }
  }
}
