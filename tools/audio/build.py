"""Builds the game's sound files in game/assets/audio/ from real recordings.

Every source is free to use (CC0, except one CC-BY 3.0 engine loop; see CREDITS.md next to the
output). The raw downloads are cached in tools/audio/src/ (not in git); the game only needs the
small processed files.

What this does:
  - engine: an AC Cobra V8 idle (low) and a high-rpm rally engine loop (high); the game
    crossfades and pitches the two by rpm
  - cuts steady parts of the tire squeal, road noise and blowtorch (nitro) recordings and turns
    them into seamless loops (the end crossfades into the start)
  - copies the crash, menu and announcer one-shots

Usage (from this folder):  python build.py
Needs Python 3.9+, numpy, ffmpeg on PATH, and 7z or bsdtar (Windows 10+ / macOS tar) for one .7z.
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
KENNEY = 'https://kenney.nl/media/pages/assets/{}.zip'
DOWNLOADS = {
    'cobra.ogg': BSB.format('0534'),  # AC Cobra 427: start, revs, idle, stop
    'tire-squeal.ogg': BSB.format('0500'),  # 17 tire squeals
    'car-interior.ogg': BSB.format('0505'),  # small car at 80-90 km/h
    'blowtorch.ogg': BSB.format('0930'),
    'whoosh.ogg': BSB.format('1795'),
    'engine-loop.7z': 'https://opengameart.org/sites/default/files/engine-loop.7z',
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
    if not (SRC / 'engine-loop').exists():
        tool = shutil.which('7z')
        cmd = [tool, 'x', '-y', f'-o{SRC}', str(SRC / 'engine-loop.7z')] if tool else ['tar', '-xf', str(SRC / 'engine-loop.7z'), '-C', str(SRC)]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)


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


def level(x, rms_db, peak=0.95):
    """Scales to a target loudness (RMS dBFS) without letting peaks clip."""
    gain = 10 ** (rms_db / 20) / np.sqrt(np.mean(x ** 2))
    return x * min(gain, peak / np.abs(x).max())


def main():
    download()

    # Engine. The idle is the steady stretch of the Cobra recording (V8 firing at ~57 Hz, about
    # 850 rpm); the high loop's fundamental is ~87 Hz. audio.js uses both numbers for pitch.
    idle = decode(SRC / 'cobra.ogg', 12.8, 7.2, af='highpass=f=30')
    encode(level(make_loop(idle, 0.5), -16), 'engine-idle.ogg')
    high = decode(SRC / 'engine-loop' / 'engine-loop-1-normalized.wav')
    encode(level(high, -16), 'engine-high.ogg')

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

    # Nitro: steady blowtorch roar, plus a whoosh when it kicks in.
    torch = decode(SRC / 'blowtorch.ogg', 10, 6.5, af='highpass=f=60')
    encode(level(make_loop(torch, 0.5), -16), 'nitro.ogg')
    whoosh = decode(SRC / 'whoosh.ogg')
    encode(level(whoosh, -16), 'nitro-start.ogg')

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
