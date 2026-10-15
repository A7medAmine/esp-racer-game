# Troubleshooting

## USB

| Problem | Fix |
|---|---|
| No port in the list | Use a USB **data** cable. Install the driver for the board's USB chip: [CP2102](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers) or [CH340](https://www.wch-ic.com/downloads/CH341SER_EXE.html) (the chip name is printed near the USB socket). |
| "Failed to open serial port" | Another program holds the port. Close Arduino IDE's Serial Monitor, `pio device monitor`, Cura, or another game tab. |
| "USB needs Chrome or Edge" | Firefox and Safari have no Web Serial. Use Chrome/Edge, or connect over WiFi. |
| Connected but chip says "no data" | The board may be stuck in flash mode: press its RST button. Or the firmware isn't installed: see [firmware.md](firmware.md). |
| Opened `index.html` directly and USB is missing | Start the game with `start-game.bat` / `start-game.sh`; USB needs `http://localhost`. |

## WiFi

| Problem | Fix |
|---|---|
| "No answer from 192.168.4.1" | Is the PC connected to the `ESP-Racer` WiFi? Windows sometimes switches back to a network with internet: tell it to stay connected. |
| Home WiFi mode never connects | ESP8266 only supports 2.4 GHz. Check name/password (case-sensitive). After 15 s it falls back to the `ESP-Racer` hotspot. |
| `esp-racer.local` doesn't resolve | Use the IP address shown in the game's Connection card (or printed on the serial monitor). |
| Laggy over WiFi | Move closer, avoid crowded 2.4 GHz channels, or use USB. |
| Need to start over | Send `RESET` over USB serial: back to hotspot mode with default name/password. |

## Controls

| Problem | Fix |
|---|---|
| Steering goes the wrong way | Run **Calibrate**, or toggle *Invert steering*. |
| Steering drifts to one side | Run **Calibrate** holding the controller the way you actually drive. |
| Steering too twitchy / too lazy | Change *Tilt for full lock* (bigger = calmer). |
| Stick gas/brake swapped | Toggle *Invert stick* (calibration step 3 does it automatically). |
| Car creeps forward or brakes by itself | The stick center was measured while touched. Send `CALJOY` with the stick released, or just replug the controller without touching the stick. |
| Status LED blinks fast / "sensor NOT FOUND" | Check ADXL345 wiring: SDA to D2, SCL to D1, VCC to 3V3, GND to GND, CS to 3V3. Loose jumper wires are the usual cause. |
| Button does nothing | SW (or the nitro button) must go to **D5**, other leg to GND. Check in **Controller > Live test**. |
| Paddles do nothing | Gas to **D6**, brake to **D7**, other legs to GND. Needs firmware 1.1: the *Connection* card says "Supports gas/brake paddles". **Live test** shows `gas 1` / `brake 1` while pressed. |
| No gas at all, controller connected | *Gas / brake* is on **Paddles** but no paddles are wired (or the firmware is 1.0). Set it back to **Joystick**. |
| Car creeps or brakes by itself, no joystick wired | Set *Gas / brake* to **Paddles**: an unconnected A0 reads noise. |
| No vibration | Needs firmware 1.1, *Vibration* not Off, and the transistor circuit (D0, 1 kΩ, transistor, diode). Try **Test vibration**. Check the transistor's E/B/C order. |
| Controller resets when it vibrates | Add the 100 µF capacitor across 3V3/GND next to the motor. |
| Motor buzzes all the time | Transistor wired wrong (collector and emitter swapped) or shorted. Unplug and check. |

## Game

| Problem | Fix |
|---|---|
| Low frame rate | Settings > Graphics quality: Medium or Low. Turn off Glow effects. Plug in the laptop charger. |
| Blank page | Make sure the page is served by the start script, then check the browser console (F12) for errors. |
| No sound | Click anywhere or press a key once: browsers only allow audio after user interaction. |
| `start-game.bat` closes immediately | Run it from a terminal to see the error. If all ports 8080-8099 are busy, run `powershell -File tools\serve.ps1 -Port 9000`. |
