// Procedural canvas textures, so the game ships without image assets.
import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, { repeat = true, srgb = true, anisotropy = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

// Deterministic random so every texture looks the same on every load.
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function speckle(ctx, w, h, count, colors, sizeMax, rand) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colors[(rand() * colors.length) | 0];
    const s = 1 + rand() * sizeMax;
    ctx.fillRect(rand() * w, rand() * h, s, s);
  }
}

// Asphalt with edge lines and a dashed center line. u = across road, v = along.
export function roadTexture() {
  const [c, ctx] = canvas(512, 512);
  const rand = rng(7);
  ctx.fillStyle = '#3a3b3f';
  ctx.fillRect(0, 0, 512, 512);
  speckle(ctx, 512, 512, 26000, ['#2c2d31', '#45464b', '#505157', '#333438', '#2a2a2d'], 2, rand);
  // Subtle darker racing line wear down the middle of each lane.
  for (const x of [150, 362]) {
    const g = ctx.createLinearGradient(x - 70, 0, x + 70, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 70, 0, 140, 512);
  }
  ctx.fillStyle = '#e9e9e4';
  ctx.fillRect(14, 0, 12, 512);
  ctx.fillRect(486, 0, 12, 512);
  ctx.fillRect(250, 0, 12, 256);
  return finish(c);
}

// Red / white curb blocks along v.
export function curbTexture() {
  const [c, ctx] = canvas(64, 256);
  ctx.fillStyle = '#d0201c';
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = '#f2f2f2';
  ctx.fillRect(0, 128, 64, 128);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, 6, 256);
  return finish(c);
}

export function grassTexture(base, light, dark, seed = 3) {
  const [c, ctx] = canvas(512, 512);
  const rand = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 512, 512);
  // Large soft patches for variation, then fine blades.
  for (let i = 0; i < 60; i++) {
    ctx.fillStyle = rand() > 0.5 ? light : dark;
    ctx.globalAlpha = 0.08 + rand() * 0.1;
    ctx.beginPath();
    ctx.arc(rand() * 512, rand() * 512, 20 + rand() * 70, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  speckle(ctx, 512, 512, 30000, [light, dark, base], 1.6, rand);
  return finish(c);
}

// Mowed stripes for the run-off area next to the track.
export function vergeTexture(light, dark) {
  const [c, ctx] = canvas(256, 256);
  const rand = rng(11);
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, 256, 128);
  ctx.fillStyle = dark;
  ctx.fillRect(0, 128, 256, 128);
  speckle(ctx, 256, 256, 9000, [light, dark], 1.4, rand);
  return finish(c);
}

// AFAQ mark (white), loaded once and drawn into textures when ready.
let afaqMark = null;
function withAfaqMark(draw) {
  if (!afaqMark) {
    afaqMark = new Image();
    afaqMark.src = 'assets/afaq/afaq-mark-white.svg';
  }
  if (afaqMark.complete && afaqMark.naturalWidth) draw(afaqMark);
  else afaqMark.addEventListener('load', () => draw(afaqMark), { once: true });
}

// Sponsor boards for the barrier walls. u = along the wall.
export function barrierTexture() {
  const [c, ctx] = canvas(1536, 128);
  // AFAQ boards use the club palette (Afaq Blue / Deep Blue); the rest keep the race look.
  const boards = [
    { text: 'ESP RACER', bg: '#0d1b3d', fg: '#fff' },
    { text: 'AFAQ', bg: '#233dff', fg: '#fff', mark: true },
    { text: 'NODEMCU', bg: '#b3121b', fg: '#fff' },
    { text: 'OPEN WEEK', bg: '#12229d', fg: '#fff', mark: true },
    { text: 'ADXL345', bg: '#111111', fg: '#fff' },
    { text: 'TILT POWER', bg: '#f0a400', fg: '#111' },
  ];
  const w = 1536 / boards.length;
  const marks = [];
  boards.forEach((bd, i) => {
    ctx.fillStyle = bd.bg;
    ctx.fillRect(i * w, 0, w, 128);
    ctx.fillStyle = bd.fg;
    ctx.font = 'italic 900 34px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Boards with the AFAQ mark: mark on the left, text centered in the remaining space.
    const tx = bd.mark ? i * w + 70 + (w - 80) / 2 : i * w + w / 2;
    ctx.fillText(bd.text, tx, 66, w - (bd.mark ? 100 : 20));
    if (bd.mark) marks.push(i * w + 14);
  });
  ctx.fillStyle = '#e8e8e8';
  ctx.fillRect(0, 0, 1536, 10);
  ctx.fillRect(0, 118, 1536, 10);
  const tex = finish(c);
  withAfaqMark((img) => {
    for (const x of marks) ctx.drawImage(img, x, 38, 52, 52);
    tex.needsUpdate = true;
  });
  return tex;
}

export function checkerTexture() {
  const [c, ctx] = canvas(256, 64);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 16; x++) {
      ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      ctx.fillRect(x * 16, y * 16, 16, 16);
    }
  return finish(c, { repeat: false });
}

export function bannerTexture(text, { afaq = false } = {}) {
  const [c, ctx] = canvas(1024, 160);
  const g = ctx.createLinearGradient(0, 0, 1024, 0);
  const [edge, mid] = afaq ? ['#12229d', '#233dff'] : ['#b3121b', '#ff3b2f'];
  g.addColorStop(0, edge);
  g.addColorStop(0.5, mid);
  g.addColorStop(1, edge);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1024, 160);
  ctx.fillStyle = '#fff';
  ctx.font = `italic 900 ${afaq ? 80 : 96}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tx = afaq ? 560 : 512;
  ctx.fillText(text, tx, 84, 860);
  const tex = finish(c, { repeat: false });
  if (afaq) {
    const left = tx - Math.min(860, ctx.measureText(text).width) / 2;
    withAfaqMark((img) => {
      ctx.drawImage(img, left - 130, 22, 116, 116);
      tex.needsUpdate = true;
    });
  }
  return tex;
}

// Crowd in the grandstand: lots of small colored dots.
export function crowdTexture() {
  const [c, ctx] = canvas(512, 128);
  const rand = rng(21);
  ctx.fillStyle = '#26272c';
  ctx.fillRect(0, 0, 512, 128);
  const palette = ['#e33', '#fc3', '#39f', '#fff', '#3c6', '#f80', '#c3f', '#222', '#d9b38c', '#8d5524'];
  for (let y = 4; y < 128; y += 9)
    for (let x = 2; x < 512; x += 6) {
      if (rand() < 0.12) continue;
      ctx.fillStyle = palette[(rand() * palette.length) | 0];
      ctx.fillRect(x + rand() * 2, y + rand() * 2, 4, 6);
    }
  return finish(c);
}

// Soft round sprite used by particles.
export function softDotTexture() {
  const [c, ctx] = canvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return finish(c, { repeat: false, srgb: false });
}
