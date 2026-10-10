# The game

A 3D arcade racer that runs in the browser (Three.js, no build step, no installs).

## Running it

| System | How |
|---|---|
| Windows | Double-click `start-game.bat`. It starts a small local web server (PowerShell, built into Windows) and opens the browser. |
| macOS / Linux | Run `./start-game.sh` (uses Python 3, preinstalled on most systems). |
| Anything else | Serve the `game/` folder with any static web server and open it on `http://localhost`. |

Use **Chrome or Edge** for USB. WiFi and keyboard work in any modern browser.

Why a local server and not just double-clicking `index.html`? Browsers block JavaScript modules and USB
access on `file://` pages. `http://localhost` is treated as secure, so both work.

The game runs fully offline (all libraries are in `game/vendor/`). Only the menu fonts and the browser
firmware installer load from the internet, and both have fallbacks.

## Modes

| Mode | Description |
|---|---|
| Race | You against up to 5 AI drivers, starting from the back of the grid. |
| Time Trial | Alone on track, chase the lap record (saved per track in the browser). |

## Tracks

| Track | Character |
|---|---|
| Harbor Circuit | Balanced: long straight, fast sweepers, one tight S |
| Alpine Ring | Twisty and technical, autumn forest |
| Canyon Speedway | Fast desert speedway, flat-out sweepers |

Each track can be raced at **Day**, **Sunset** or **Night** (headlights, glowing lamps, stars).

## Controls

| Action | ESP controller | Keyboard |
|---|---|---|
| Steer | Tilt left / right | Arrow keys or A / D |
| Gas | Stick up | Up or W |
| Brake, then reverse when stopped | Stick down | Down or S |
| Nitro | Hold the stick button | Space or Shift |
| Pause | Double-click the stick button | Esc or P |
| Camera | | C |
| Back on track | Pause > Put car back on track | R |
| Menus | Stick up/down to move, tilt to change values, click to select | Arrows, Enter, Esc, or mouse |

Driving tips: the car slides when you take a corner too fast (tire smoke, lost speed), so brake before
tight turns. Nitro refills slowly by itself and faster while drifting. Grass slows you down. Driving the
wrong way for a few seconds puts you back on track automatically.

## Settings

- **Graphics quality**: High (shadows, 4x MSAA, full resolution), Medium, Low (for older laptops).
- **Glow effects**: bloom on lights, nitro and the sky.
- **Show FPS**: frame counter at the bottom.
- **Volume**: all sound is synthesized live (engine with gear shifts, tire screech, wind, nitro).

## Code map

```
game/
  index.html            page, HUD and menu markup
  css/style.css         look of menus and HUD
  js/main.js            renderer, post-processing, game states, controller screen, calibration
  js/race.js            race session: world, cars, AI, countdown, laps, positions, collisions
  js/vehicle.js         car physics (TUNING constants at the top)
  js/ai.js              AI drivers
  js/camera.js          chase / far / hood cameras, showroom orbit
  js/effects.js         smoke, dust, nitro flames, sparks, skid marks
  js/audio.js           synthesized sound
  js/hud.js             speedometer, minimap, lap panel
  js/ui.js              menu navigation
  js/settings.js        saved settings and menu options
  js/input/             controller.js (input mapping), serial.js (USB), wifi.js (WebSocket), protocol.js
  js/world/             tracks.js (track list), track.js (road geometry), environment.js (sky,
                        lighting, scenery), car-model.js, textures.js (procedural textures)
  assets/afaq/          AFAQ Scientific Club mark and pixel font (Open Week branding)
  flash/                browser firmware installer + prebuilt firmware.bin
  vendor/three/         Three.js r170 (MIT)
```

## Making your own track

Add an entry to `game/js/world/tracks.js`:

```js
{
  id: 'my-track',
  name: 'My Track',
  theme: 'meadow', // meadow | autumn | desert
  points: [[0, 0], [200, 0], [320, 120], /* ... */ [-150, 0]],
}
```

`points` are `[x, z]` positions in meters that the road passes through, in driving order; the loop
closes by itself. Rules of thumb: the first point is the start line, so keep its neighbors in a straight
line with it; keep points 100 to 250 m apart; keep separate parts of the track at least 60 m apart; and
avoid corners tighter than about 30 m radius. Tune car handling with `TUNING` in `game/js/vehicle.js`.
