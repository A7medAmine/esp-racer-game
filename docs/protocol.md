# Protocol

Plain text, one message per line (`\n`). Identical over USB serial (115200 baud, 8N1) and over the
WebSocket (`ws://<controller-ip>:81/`, one text frame per line). This makes it easy to debug with a
serial monitor and to write other clients (Python, Unity, Godot...).

## Controller to game

| Prefix | Example | Meaning |
|---|---|---|
| `D,` | `D,1523,-152,34,-870,1,1` | Data frame (default 60 per second) |
| `I ` | `I {"fw":"1.0.0","sensor":"ADXL345",...}` | Device info (JSON), sent at boot, after `INFO` and after WiFi changes |
| `OK` | `OK WIFI APPLY` | Command accepted |
| `ERR` | `ERR RATE must be 10..100` | Command rejected |
| `#` | `# WiFi connected, IP 192.168.1.42` | Log line for humans |

Anything else (for example the ESP8266 ROM's boot noise) should be ignored.

### Data frame

```
D,<seq>,<roll>,<pitch>,<joy>,<btn>,<flags>
```

| Field | Type | Range | Meaning |
|---|---|---|---|
| seq | uint | 0.. | Frame counter, wraps at 2^32 |
| roll | int | -1800..1800 | Roll angle in tenths of a degree |
| pitch | int | -900..900 | Pitch angle in tenths of a degree |
| joy | int | -1000..1000 | Stick Y, centered with dead zone applied. Sign depends on how the stick is mounted |
| btn | 0/1 | | Stick button, debounced, 1 = pressed |
| flags | bit field | | bit 0: tilt sensor OK |

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
  "joyCenter": 517
}
```

`wifiState` is one of `off`, `ap`, `connecting`, `sta`, `ap-fallback`. The home WiFi password is never sent back.

## Game to controller

Text commands, one per line, case-insensitive command names. See the table in
[connecting.md](connecting.md#serial-commands). Replies (`OK` / `ERR`) go to both USB and WiFi.

## Writing your own client (Python example)

```python
import serial  # pip install pyserial

with serial.Serial("COM5", 115200, timeout=1) as port:
    port.write(b"INFO\n")
    for raw in port:
        line = raw.decode(errors="ignore").strip()
        if line.startswith("D,"):
            _, seq, roll, pitch, joy, btn, flags = line.split(",")
            print(f"roll {int(roll) / 10:6.1f}  stick {int(joy) / 1000:+.2f}  button {btn}")
```
