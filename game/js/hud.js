// Heads-up display: lap/time panel, position, speedometer, minimap, messages.
export function formatTime(ms) {
  if (ms == null || !Number.isFinite(ms)) return '--';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mm = Math.floor(ms % 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(mm).padStart(3, '0')}`;
}

export class Hud {
  constructor() {
    this.root = document.getElementById('hud');
    this.el = {
      lap: document.getElementById('hud-lap'),
      time: document.getElementById('hud-time'),
      last: document.getElementById('hud-last'),
      best: document.getElementById('hud-best'),
      pos: document.getElementById('hud-pos'),
      posTotal: document.getElementById('hud-pos-total'),
      posPanel: document.getElementById('hud-pos-panel'),
      message: document.getElementById('hud-message'),
      countdown: document.getElementById('countdown'),
    };
    this.speedo = document.getElementById('speedo');
    this.sctx = this.speedo.getContext('2d');
    this.minimap = document.getElementById('minimap');
    this.mctx = this.minimap.getContext('2d');
    this.mapImage = null;
    this.msgTimer = 0;
    this.cache = {};
  }

  show(on) {
    this.root.classList.toggle('hidden', !on);
  }

  set(key, text) {
    if (this.cache[key] !== text) {
      this.cache[key] = text;
      this.el[key].textContent = text;
    }
  }

  message(text, seconds = 2) {
    this.el.message.textContent = text;
    this.el.message.classList.add('show');
    this.msgTimer = seconds;
  }

  countdown(text) {
    const el = this.el.countdown;
    el.textContent = text;
    el.classList.remove('pop');
    void el.offsetWidth; // restart animation
    if (text) el.classList.add('pop');
  }

  // Pre-render the track outline for the minimap.
  setTrack(track) {
    const b = track.bounds();
    const size = this.minimap.width;
    const pad = 16;
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    this.mapScale = (size - pad * 2) / span;
    this.mapOx = pad + ((size - pad * 2) - (b.maxX - b.minX) * this.mapScale) / 2 - b.minX * this.mapScale;
    this.mapOz = pad + ((size - pad * 2) - (b.maxZ - b.minZ) * this.mapScale) / 2 - b.minZ * this.mapScale;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(8,10,18,0.55)';
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i <= track.N; i++) {
        const k = i % track.N;
        const [x, y] = this.mapPoint(track.px[k], track.pz[k]);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
    };
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 9;
    path();
    ctx.stroke();
    ctx.strokeStyle = '#e8ebf2';
    ctx.lineWidth = 4;
    path();
    ctx.stroke();
    const [sx, sy] = this.mapPoint(track.px[0], track.pz[0]);
    ctx.fillStyle = '#ff3b2f';
    ctx.fillRect(sx - 3, sy - 3, 6, 6);
    this.mapImage = c;
  }

  mapPoint(x, z) {
    // (x, z) maps straight to canvas (x, y): a top view rotated 180 degrees, never mirrored.
    return [x * this.mapScale + this.mapOx, z * this.mapScale + this.mapOz];
  }

  drawMinimap(cars, player) {
    const ctx = this.mctx;
    const size = this.minimap.width;
    ctx.clearRect(0, 0, size, size);
    if (this.mapImage) ctx.drawImage(this.mapImage, 0, 0);
    for (const car of [...cars].sort((a) => (a === player ? 1 : -1))) {
      const [x, y] = this.mapPoint(car.x, car.z);
      ctx.beginPath();
      ctx.arc(x, y, car === player ? 6 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = car.cssColor;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = car === player ? '#fff' : 'rgba(0,0,0,0.7)';
      ctx.stroke();
    }
  }

  drawSpeedo(car) {
    const ctx = this.sctx;
    const W = this.speedo.width;
    const cx = W / 2, cy = W / 2, r = W * 0.4;
    const kmh = Math.abs(car.forwardSpeed) * 3.6;
    const maxKmh = 320;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    ctx.clearRect(0, 0, W, W);

    ctx.fillStyle = 'rgba(8,10,18,0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 18, 0, Math.PI * 2);
    ctx.fill();

    // Ticks
    for (let v = 0; v <= maxKmh; v += 20) {
      const a = a0 + (a1 - a0) * (v / maxKmh);
      const major = v % 40 === 0;
      ctx.strokeStyle = v >= 260 ? '#ff3b2f' : 'rgba(255,255,255,0.75)';
      ctx.lineWidth = major ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - (major ? 14 : 8)), cy + Math.sin(a) * (r - (major ? 14 : 8)));
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.stroke();
      if (major) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '600 13px Rajdhani, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(v), cx + Math.cos(a) * (r - 28), cy + Math.sin(a) * (r - 28));
      }
    }

    // Speed arc
    const frac = Math.min(1, kmh / maxKmh);
    const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    grad.addColorStop(0, '#38e1ff');
    grad.addColorStop(0.7, '#ffb020');
    grad.addColorStop(1, '#ff3b2f');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r + 8, a0, a0 + (a1 - a0) * frac);
    ctx.stroke();
    ctx.lineCap = 'butt';

    // Digital readout
    ctx.fillStyle = '#fff';
    ctx.font = 'italic 900 46px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.round(kmh)), cx, cy + 4);
    ctx.font = '600 12px Orbitron, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('KM/H', cx, cy + 34);
    const gear = car.reversing && car.forwardSpeed < 0.5 ? 'R' : Math.abs(car.forwardSpeed) < 0.5 && car.throttle < 0.05 ? 'N' : 'D';
    ctx.font = '800 20px Orbitron, sans-serif';
    ctx.fillStyle = gear === 'R' ? '#ff3b2f' : '#ffb020';
    ctx.fillText(gear, cx, cy - 36);

    // Nitro bar
    const bw = r * 1.3, bh = 9, bx = cx - bw / 2, by = cy + r * 0.78;
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(bx, by, bw, bh);
    const ng = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    ng.addColorStop(0, '#2a7bff');
    ng.addColorStop(1, '#38e1ff');
    ctx.fillStyle = car.nitroActive ? '#ffffff' : ng;
    ctx.fillRect(bx, by, bw * car.nitro, bh);
    ctx.font = '700 10px Orbitron, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('NITRO', cx, by + bh + 11);
  }

  update(dt) {
    if (this.msgTimer > 0) {
      this.msgTimer -= dt;
      if (this.msgTimer <= 0) this.el.message.classList.remove('show');
    }
  }
}
