# Protocol

Plain text, one message per line (`\n`). Identical over USB serial (115200 baud, 8N1) and over the
WebSocket (`ws://<controller-ip>:81/`, one text frame per line). This makes it easy to debug with a
serial monitor and to write other clients (Python, Unity, Godot...).

## Controller to game

| Prefix | Example | Meaning |
|---|---|---|
| `D,` | `D,1523,-152,34,-870,1,1,0,0` | Data frame (default 60 per second) |
| `I ` | `I {"fw":"1.0.0","sensor":"ADXL345",...}` | Device info (JSON), sent at boot, after `INFO` and after WiFi changes |
| `OK` | `OK WIFI APPLY` | Command accepted |
| `ERR` | `ERR RATE must be 10..100` | Command rejected |
| `#` | `# WiFi connected, IP 192.168.1.42` | Log line for humans |

Anything else (for example the ESP8266 ROM's boot noise) should be ignored.

### Data frame

```
D,<seq>,<roll>,<pitch>,<joy>,<btn>,<flags>,<gas>,<brake>
```

| Field | Type | Range | Meaning |
|---|---|---|---|
| seq | uint | 0.. | Frame counter, wraps at 2^32 |
| roll | int | -1800..1800 | Roll angle in tenths of a degree |
| pitch | int | -900..900 | Pitch angle in tenths of a degree |
| joy | int | -1000..1000 | Stick Y, centered with dead zone applied. Sign depends on how the stick is mounted |
| btn | 0/1 | | Nitro: stick button or breadboard button on D5, debounced, 1 = pressed |
| flags | bit field | | bit 0: tilt sensor OK |
| gas | 0/1 | | Gas paddle on D6, debounced (firmware 1.1+) |
| brake | 0/1 | | Brake paddle on D7, debounced (firmware 1.1+) |

Firmware 1.0 stops after `flags`. Clients should treat missing `gas` / `brake` as 0, and ignore any extra
fields a later version may add.

Angles come from gravity (and the gyroscope on an MPU6050), already smoothed. Mounting orientation is
not assumed: the game picks the axis, sign, center offset and sensitivity during calibration.

### Info JSON

```json
{
  "fw": "1.0.0",
  "sensor": "ADXL345",
  "sensorAddr": "0x53",
  "sensorOk": true,
  "wifiMode": "AP",
  "wifiState": "ap",
  "ip": "192.168.4.1",
  "wsPort": 81,
  "apSsid": "ESP-Racer",
  "apPass": "racer1234",
  "staSsid": "",
  "hz": 60,
  "joyCenter": 517,
  "caps": ["pedals", "haptics"]
}
```

`caps` (firmware 1.1+) lists optional features: `pedals` = gas/brake fields in the data frame,
`haptics` = the `VIB` command. Firmware 1.0 has no `caps` field.

`wifiState` is one of `off`, `ap`, `connecting`, `sta`, `ap-fallback`. The home WiFi password is never sent back.

## Game to controller

Text commands, one per line, case-insensitive command names. See the table in
[connecting.md](connecting.md#serial-commands). Replies (`OK` / `ERR`) go to both USB and WiFi.

### Vibration: `VIB <strength> [ms]`

| Argument | Range | Meaning |
|---|---|---|
| strength | 0..100 | Motor PWM duty in percent. 0 stops the motor |
| ms | 0..2000 | How long to run, default 200. Longer values are clamped to 2000 |

The motor always stops by itself when `ms` runs out, so it can't stay on if the game crashes or WiFi drops.
A new `VIB` replaces the running one. A successful `VIB` sends **no** `OK` reply, because the game sends it
up to 20 times per second; a malformed one replies `ERR`. The game keeps a continuous rumble going by
resending `VIB <s> 260` every 150 ms.

## Writing your own client (Python example)

```python
import serial  # pip install pyserial

with serial.Serial("COM5", 115200, timeout=1) as port:
    port.write(b"INFO\n")
    for raw in port:
        line = raw.decode(errors="ignore").strip()
        if line.startswith("D,"):
            _, seq, roll, pitch, joy, btn, flags, *rest = line.split(",")
            print(f"roll {int(roll) / 10:6.1f}  stick {int(joy) / 1000:+.2f}  button {btn}")
```
