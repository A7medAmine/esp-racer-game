# Firmware: installing and building

The firmware lives in [`firmware/esp-racer-controller/`](../firmware/esp-racer-controller). Pick **one** of the
three ways below. Option A is the easiest.

## Option A: install from the browser (no software needed)

1. Start the game (`start-game.bat` on Windows, `./start-game.sh` on macOS/Linux).
2. In the game open **Controller > Install firmware on the ESP8266**, or go to `http://localhost:8080/flash/`.
3. Plug in the NodeMCU, click **Connect & install**, pick the port, confirm.

This flashes the prebuilt `game/flash/firmware.bin`. Needs Chrome or Edge, and internet once to load the installer.

## Option B: PlatformIO (VS Code)

1. Install VS Code and the **PlatformIO IDE** extension.
2. Open the `firmware/` folder.
3. Click **Upload** (the arrow in the status bar), or from a terminal in `firmware/`:

   ```sh
   pio run -t upload        # build and flash (NodeMCU)
   pio run -e d1_mini -t upload   # for a Wemos D1 mini
   pio device monitor       # watch the serial output (115200 baud)
   ```

PlatformIO installs the ESP8266 core and the WebSockets library by itself.

## Option C: Arduino IDE

1. **File > Preferences > Additional boards manager URLs**, add:
   `https://arduino.esp8266.com/stable/package_esp8266com_index.json`
2. **Tools > Board > Boards Manager**, install **esp8266 by ESP8266 Community**.
3. **Sketch > Include Library > Manage Libraries**, install **WebSockets by Markus Sattler** (links2004).
4. Open `firmware/esp-racer-controller/esp-racer-controller.ino`.
5. **Tools > Board**: *NodeMCU 1.0 (ESP-12E Module)* (or *LOLIN(WEMOS) D1 mini*). Pick the port, click **Upload**.

## Checking that it works

Open a serial monitor at **115200 baud** (Arduino IDE, `pio device monitor`, or any terminal). You should see:

```
# ESP Racer controller 1.0.0
# Tilt sensor: ADXL345 at 0x53
# Joystick center: 517 (keep the stick released while booting)
I {"fw":"1.0.0","sensor":"ADXL345",...}
D,0,12,-35,0,0,1
D,1,13,-34,0,0,1
...
```

`D,...` lines are the live controller data (see [protocol.md](protocol.md)). Type `HELP` and press Enter to list commands.

Close the serial monitor before playing: only one program can use the USB port at a time.

## Updating the prebuilt binary (for maintainers)

After changing the firmware, rebuild and refresh the file used by the browser installer:

```sh
# Windows (PowerShell)
tools\build-firmware.ps1
# macOS / Linux
./tools/build-firmware.sh
```

Both run `pio run` and copy `.pio/build/nodemcuv2/firmware.bin` to `game/flash/firmware.bin`.
Bump `FW_VERSION` in `config.h` and `version` in `game/flash/manifest.json` together.

## Configuration

Everything has working defaults. Build-time options are in
[`config.h`](../firmware/esp-racer-controller/config.h): pins, stream rate, smoothing, default WiFi
hotspot name and password. WiFi settings can also be changed at runtime from the game or with serial
commands, without re-flashing (see [connecting.md](connecting.md)).
