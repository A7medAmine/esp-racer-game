# Connecting the controller: USB and WiFi

The controller always streams over USB. WiFi can run at the same time; you choose in the game which
one to use. Both carry exactly the same data, so everything works the same way over either.

| | USB (serial) | WiFi (WebSocket) |
|---|---|---|
| Setup | Plug in, click Connect USB | Join the controller's WiFi (or put both on your home WiFi), click Connect WiFi |
| Latency | Lowest | Low (a few ms more) |
| Cable | Yes | No, power it from a power bank |
| Browser | Chrome or Edge (Web Serial) | Any modern browser |

## USB

1. Start the game with `start-game.bat` (Windows) or `./start-game.sh` (macOS/Linux).
2. Plug the controller in. **Keep the stick released**: the controller resets when the port opens and
   measures the stick's center position during boot.
3. In the game: **Controller > Connect USB**, choose the port (CP2102 / CH340 / "USB Serial"), done.

The game remembers the port. With **Auto-connect on start** on (default), next time it reconnects by itself.

## WiFi mode 1: the controller's own hotspot (default)

Out of the box the controller creates its own WiFi network:

| Setting | Default |
|---|---|
| Network name | `ESP-Racer` |
| Password | `racer1234` |
| Controller address | `192.168.4.1` |

1. Power the controller (USB or power bank).
2. Connect the PC to the WiFi `ESP-Racer`. (The PC has no internet while connected; the game works offline.)
3. Start the game, **Controller > Connect WiFi** with address `192.168.4.1`.

To change the hotspot name or password, use the serial commands `WIFI APSSID` / `WIFI APPASS` below.

## WiFi mode 2: join your home WiFi

Useful when the PC must keep its internet, or for event setups with several screens.

1. Connect the controller with **USB** first.
2. **Controller > Controller WiFi setup**: set *WiFi mode* to **Home WiFi**, enter the network name and
   password, click **Send to controller**.
3. After a few seconds the controller's IP address appears in the *Connection* card and is copied into
   *WiFi address*. You can also use `esp-racer.local` on most systems.
4. Now unplug USB (power from a power bank) and click **Connect WiFi**.

If the controller can't join the network within 15 seconds it falls back to its own hotspot (mode 1),
so you can never lock yourself out. 2.4 GHz networks only (ESP8266 limitation). Networks with a login
page (hotel/campus portals) won't work: use the hotspot mode there.

## Calibration (do this once)

**Controller > Calibrate (guided)**:

1. Hold the controller level, the way you'll drive. Press the stick button.
2. Tilt fully to the right. Press the stick button.
3. Push the stick up and hold it.

The game works out the steering axis, the direction, how much tilt means full lock, and which stick
direction is "gas". Settings are saved in the browser. Fine-tune under **Tuning**:

| Setting | What it does |
|---|---|
| Steering axis | Roll = tilt sideways like a wheel. Pitch = tilt forward/back. |
| Invert steering / stick | Flip directions. |
| Tilt for full lock | Smaller = more sensitive. |
| Steering response | *Precise center* makes small tilts gentler for straight-line stability. |

The **Live test** panel shows exactly what the game receives.

## Serial commands

Send these from the Arduino Serial Monitor (115200 baud, line ending *Newline*) or any serial terminal.
They also work over the WebSocket.

| Command | Effect |
|---|---|
| `HELP` | List commands |
| `INFO` | Print device info as JSON (firmware, sensor, WiFi state, IP) |
| `PING` | Replies `OK PONG` |
| `CALJOY` | Re-measure the stick center (keep it released) |
| `RATE <10-100>` | Data frames per second (default 60) |
| `WIFI MODE OFF\|AP\|STA` | USB only / own hotspot / join home WiFi |
| `WIFI SSID <name>` | Home WiFi name (spaces allowed) |
| `WIFI PASS <password>` | Home WiFi password |
| `WIFI APSSID <name>` | Hotspot name |
| `WIFI APPASS <password>` | Hotspot password (8+ characters) |
| `WIFI APPLY` | Save the WiFi settings and restart WiFi |
| `RESET` | Factory defaults |
| `REBOOT` | Restart the controller |

Example, joining a home network from a serial monitor:

```
WIFI MODE STA
WIFI SSID My Home Network
WIFI PASS secret-password
WIFI APPLY
```
