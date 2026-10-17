"""Builds the game's sound files in game/assets/audio/ from real recordings.

Every source is free to use (CC0; see CREDITS.md next to the output). The raw downloads are
cached in tools/audio/src/ (not in git); the game only needs the small processed files.

What this does:
  - engine: three loops (idle, mid and high rpm) cut from one Lamborghini V12 recording. Each is
    pitch-flattened to a fixed firing frequency so the game can crossfade and pitch them by rpm
  - exhaust pops: single bangs cut from an anti-lag recording, fired when lifting off or shifting
  - nitro: a jet afterburner (ignition one-shot, plus a steady roar loop with some blowtorch hiss)
  - cuts steady parts of the tire squeal and road noise recordings and turns them into seamless
    loops (the end crossfades into the start)
  - copies the crash, menu and announcer one-shots

Usage (from this folder):  python build.py
Needs Python 3.9+, numpy and ffmpeg on PATH.
"""
import shutil
import subprocess
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
SRC = HERE / 'src'
OUT = HERE.parent.parent / 'game' / 'assets' / 'audio'
SR = 48000

BSB = 'https://bigsoundbank.com/UPLOAD/ogg/{}.ogg'
FREESOUND = 'https://cdn.freesound.org/previews/{}-hq.mp3'  # high-quality preview, no login needed
KENNEY = 'https://kenney.nl/media/pages/assets/{}.zip'
DOWNLOADS = {
    'lambo.mp3': FREESOUND.format('112/112075_682033'),  # Lamborghini V12: idle, then revs
    'antilag.mp3': FREESOUND.format('797/797835_15956618'),  # anti-lag exhaust bangs
    'afterburner.mp3': FREESOUND.format('413/413312_1511977'),  # steady jet afterburner
    'afterburner-onset.mp3': FREESOUND.format('829/829068_17949749'),  # close, quick onset
    'tire-squeal.ogg': BSB.format('0500'),  # 17 tire squeals
    'car-interior.ogg': BSB.format('0505'),  # small car at 80-90 km/h
    'blowtorch.ogg': BSB.format('0930'),
    'impact.zip': KENNEY.format('impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds'),
    'interface.zip': KENNEY.format('interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds'),
    'voiceover.zip': KENNEY.format('voiceover-pack/3f7f168698-1677589897/kenney_voiceover-pack'),
}

# Announcer lines: game name -> Kenney voiceover file.
VOICE_LINES = {
    '3': '3', '2': '2', '1': '1', 'go': 'go',
    'final-round': 'final_round', 'new-record': 'new_highscore',
    'you-win': 'you_win', 'you-lose': 'you_lose', 'congratulations': 'congratulations', 'wrong': 'wrong',
}

# Crash one-shots: game name -> Kenney impact file.
HITS = {
    **{f'hit-heavy-{i + 1}': f'impactPlate_heavy_00{i}' for i in range(3)},
    **{f'hit-medium-{i + 1}': f'impactMetal_medium_00{i}' for i in range(3)},
    **{f'hit-light-{i + 1}': f'impactMetal_light_00{i}' for i in range(3)},
}


def download():
    SRC.mkdir(exist_ok=True)
    for name, url in DOWNLOADS.items():
        path = SRC / name
        if path.exists():
            continue
        print('download', url)
        # BigSoundBank refuses requests without a browser user agent.
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as res:
            path.write_bytes(res.read())
    for name in ('impact', 'interface', 'voiceover'):
        if not (SRC / name).exists():
            with zipfile.ZipFile(SRC / f'{name}.zip') as z:
                z.extractall(SRC / name)


def decode(path, start=0.0, dur=None, af=None):
    """Mono float32 samples at SR, optionally a slice and an ffmpeg filter."""
    cmd = ['ffmpeg', '-v', 'error', '-ss', str(start)]
    if dur:
        cmd += ['-t', str(dur)]
    cmd += ['-i', str(path), '-ac', '1', '-ar', str(SR)]
    if af:
        cmd += ['-af', af]
    cmd += ['-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(cmd, check=True, capture_output=True).stdout, np.float32).astype(np.float64)


def encode(x, name, quality=5):
    OUT.mkdir(parents=True, exist_ok=True)
    cmd = ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
           '-c:a', 'libvorbis', '-q:a', str(quality), str(OUT / name)]
    subprocess.run(cmd, input=x.astype(np.float32).tobytes(), check=True)
    print(f'{name:22} {len(x) / SR:5.2f} s')


def make_loop(x, fade):
    """Seamless loop: the last `fade` seconds crossfade (equal power) into the start."""
    n = int(fade * SR)
    out = x[:-n].copy()
    t = np.linspace(0, 1, n)
    out[:n] = x[:n] * np.sqrt(t) + x[-n:] * np.sqrt(1 - t)
    return out


def chain(parts, fade):
    """Joins clips with equal-power crossfades."""
    n = int(fade * SR)
    t = np.linspace(0, 1, n)
    out = parts[0]
    for p in parts[1:]:
        out = np.concatenate([out[:-n], out[-n:] * np.sqrt(1 - t) + p[:n] * np.sqrt(t), p[n:]])
    return out


def track_pitch(x, lo, hi):
    """Frequency of the strongest partial between lo and hi Hz every 10 ms, as (times, Hz)."""
    win, hop = int(0.12 * SR), int(0.01 * SR)
    n = 8 * win
    freqs = np.fft.rfftfreq(n, 1 / SR)
    band = np.where((freqs > lo) & (freqs < hi))[0]
    times, hz = [], []
    for i in range(0, len(x) - win, hop):
        m = np.log(np.abs(np.fft.rfft(x[i:i + win] * np.hanning(win), n))[band] + 1e-12)
        k = int(np.argmax(m))
        if 0 < k < len(m) - 1:  # parabolic interpolation between FFT bins
            a, b, c = m[k - 1:k + 2]
            k += 0.5 * (a - c) / (a - 2 * b + c)
        times.append((i + win / 2) / SR)
        hz.append(freqs[band[0]] + k * freqs[1])
    hz = np.array(hz)
    return np.array(times), np.array([np.median(hz[max(0, i - 4):i + 5]) for i in range(len(hz))])


def flatten(x, lo, hi, target):
    """Resamples at a varying rate so the firing frequency (tracked between lo and hi Hz) stays at
    `target` Hz; the game then knows each engine loop's exact pitch."""
    times, hz = track_pitch(x, lo, hi)
    stretch = np.interp(np.arange(len(x)) / SR, times, hz) / target  # output samples per input sample
    out_pos = np.concatenate([[0], np.cumsum(stretch[:-1])])
    src_pos = np.interp(np.arange(int(out_pos[-1])), out_pos, np.arange(len(x)))
    return np.interp(src_pos, np.arange(len(x)), x)


def engine_loop(spans, lo, hi, target, fade=0.12):
    """Steady stretches of the V12 recording, pitch-flattened and chained into a seamless loop."""
    parts = [flatten(decode(SRC / 'lambo.mp3', a, b - a, af='highpass=f=35'), lo, hi, target) for a, b in spans]
    return make_loop(chain(parts, fade), fade)


def pops(path, spans, count, length=0.22):
    """The `count` loudest bangs in the given stretches, each cut from just before its onset."""
    x = decode(path, af='highpass=f=60')
    w = int(0.005 * SR)
    env = np.sqrt(np.convolve(x ** 2, np.ones(w) / w, mode='same'))
    found = []
    for a, b in spans:
        i, end = int(a * SR), int(b * SR)
        floor = np.median(env[i:end])
        while i < end:
            if env[i] > 4 * floor:  # onset: the envelope jumps well above the background
                found.append((env[i:i + int(0.05 * SR)].max(), i))
                i += int(0.12 * SR)
            else:
                i += w
    n = int(length * SR)
    t = np.arange(n) / SR
    shape = np.minimum(1, t / 0.003) * np.exp(-t / (length / 4))  # 3 ms attack, fast decay
    starts = [i - int(0.004 * SR) for _, i in sorted(found, reverse=True)[:count]]
    return [x[s:s + n] * shape for s in starts]


def level(x, rms_db, peak=0.95):
    """Scales to a target loudness (RMS dBFS) without letting peaks clip."""
    gain = 10 ** (rms_db / 20) / np.sqrt(np.mean(x ** 2))
    return x * min(gain, peak / np.abs(x).max())


def main():
    download()

    # Engine: a Lamborghini V12 (6 firings per revolution). The idle near 1170 rpm and revs held
    # near 4000 and 5700 rpm, each flattened to an exact firing frequency that audio.js uses for
    # pitch: idle 117 Hz, mid 400 Hz, high 570 Hz.
    encode(level(engine_loop([(4.4, 7.3)], 100, 135, 117, fade=0.3), -16), 'engine-idle.ogg')
    encode(level(engine_loop([(42.0, 42.8), (49.9, 51.0), (54.6, 56.0)], 330, 450, 400), -16), 'engine-mid.ogg')
    encode(level(engine_loop([(43.1, 44.5), (46.6, 47.7), (58.4, 59.5)], 520, 610, 570), -16), 'engine-high.ogg')

    # Exhaust pops: single anti-lag bangs, played in bursts when lifting off at high rpm.
    for i, pop in enumerate(pops(SRC / 'antilag.mp3', [(1.15, 2.9), (4.35, 7.8)], 4)):
        encode(level(pop, -14), f'pop-{i + 1}.ogg')

    # Tire squeal: the middle of five separate squeals, chained into one ~2.5 s loop.
    squeals = [(3.7, 4.62), (5.5, 6.23), (7.1, 7.87), (16.12, 16.89), (17.72, 18.52)]
    parts = []
    for a, b in squeals:
        trim = (b - a) * 0.15
        parts.append(decode(SRC / 'tire-squeal.ogg', a + trim, b - a - 2 * trim))
    encode(level(make_loop(chain(parts, 0.08), 0.08), -16), 'skid.ogg')

    # Road and tire roar from inside a car; the band-pass drops the car's own engine hum.
    road = decode(SRC / 'car-interior.ogg', 20, 8.5, af='highpass=f=260,lowpass=f=5000')
    encode(level(make_loop(road, 0.5), -18), 'road.ogg')

    # Nitro: a steady afterburner roar with some blowtorch hiss on top, and the afterburner
    # lighting up (quick onset, faded out) when it kicks in.
    jet = decode(SRC / 'afterburner.mp3', 1.0, 4.2, af='highpass=f=40')
    torch = decode(SRC / 'blowtorch.ogg', 10, 4.2, af='highpass=f=800')
    n = min(len(jet), len(torch))
    roar = level(jet[:n], -16) + 0.35 * level(torch[:n], -16)
    encode(level(make_loop(roar, 0.5), -15), 'nitro.ogg')
    onset = decode(SRC / 'afterburner-onset.mp3', 0.7, 2.6, af='highpass=f=40')
    fade = int(1.2 * SR)
    onset[-fade:] *= np.linspace(1, 0, fade) ** 2
    encode(level(onset, -13), 'nitro-start.ogg')

    for name, src in HITS.items():
        shutil.copy(SRC / 'impact' / 'Audio' / f'{src}.ogg', OUT / f'{name}.ogg')
    shutil.copy(SRC / 'interface' / 'Audio' / 'select_001.ogg', OUT / 'ui-move.ogg')
    shutil.copy(SRC / 'interface' / 'Audio' / 'confirmation_001.ogg', OUT / 'ui-confirm.ogg')

    for voice in ('Male', 'Female'):
        folder = OUT / 'voice' / voice.lower()
        folder.mkdir(parents=True, exist_ok=True)
        for name, src in VOICE_LINES.items():
            shutil.copy(SRC / 'voiceover' / voice / f'{src}.ogg', folder / f'{name}.ogg')
    print('copied', len(HITS), 'crash sounds, 2 menu sounds,', 2 * len(VOICE_LINES), 'announcer lines')


if __name__ == '__main__':
    main()
