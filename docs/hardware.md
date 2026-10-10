# Hardware: parts, pinout and wiring

![Wiring diagram](wiring.svg)

## Parts list

| Part | Notes |
|---|---|
| NodeMCU v2 / v3 (ESP8266, ESP-12E) | Any NodeMCU works. A Wemos D1 mini also works (same pin labels). |
| ADXL345 accelerometer module (GY-291) | Tilt steering. Can be swapped for an MPU6050 later, see below. |
| Analog joystick module (KY-023 or similar) | Gas / brake / reverse on the Y axis, nitro on the push button. |
| 9 female-female jumper wires (or a breadboard + male wires) | |
| Micro USB **data** cable | Some cables only charge. If no port appears on the PC, try another cable. |
| Optional: power bank | For wireless play over WiFi. |

## Pinout

### ADXL345 (GY-291) to NodeMCU

| ADXL345 pin | NodeMCU pin | Why |
|---|---|---|
| VCC | **3V3** | Power |
| GND | **GND** | Ground |
| SDA | **D2** (GPIO4) | I2C data |
| SCL | **D1** (GPIO5) | I2C clock |
| CS | **3V3** | Selects I2C mode (a short jumper to VCC on the module is fine) |
| SDO | **GND** | Sets I2C address 0x53 (to 3V3 also works, address becomes 0x1D) |
| INT1, INT2 | not connected | |

### Joystick (KY-023) to NodeMCU

| Joystick pin | NodeMCU pin | Why |
|---|---|---|
| GND | **GND** | Ground |
| +5V | **3V3** | Power. **Use 3V3, not 5V/Vin.** At 5V the stick would go past the ADC range. |
| VRy | **A0** | Gas (push up) / brake + reverse (pull down) |
| VRx | not connected | The ESP8266 has only one analog input; steering comes from tilt. |
| SW | **D5** (GPIO14) | Push button = nitro (hold) / pause (double-click) / select in menus |

The joystick button needs no resistor: the firmware enables the ESP8266's internal pull-up.

### Status LED (on-board, nothing to wire)

| Blue LED on the NodeMCU | Meaning |
|---|---|
| Short blink every second | Running normally |
| Fast blinking | Tilt sensor not found: check SDA/SCL/VCC/GND |
| Solid on | A game is connected over WiFi |

### Pins to avoid

D3 (GPIO0), D4 (GPIO2) and D8 (GPIO15) decide how the ESP8266 boots. Keep buttons and sensors off them.
D4 also drives the blue LED.

## Assembly tips

1. Wire everything **with the USB cable unplugged**.
2. Mount the ADXL345 flat and firmly (hot glue or double-sided tape) on whatever you hold: a piece of
   cardboard, a 3D-printed wheel, a plastic box. If it wobbles, steering will jitter.
3. Mount the joystick so that "up" is natural for your thumb. Which way is "up" doesn't matter:
   the game's calibration detects it.
4. Orientation of the sensor doesn't matter either. Run **Controller > Calibrate** in the game once and
   it figures out the steering axis and direction.
5. Keep the I2C wires (SDA/SCL) short, ideally under 20 cm.

## Upgrading to an MPU6050 later

The firmware auto-detects the sensor at boot. To switch, remove the ADXL345 and wire the MPU6050 (GY-521):

| MPU6050 pin | NodeMCU pin |
|---|---|
| VCC | 3V3 |
| GND | GND |
| SCL | D1 |
| SDA | D2 |
| AD0 | GND (address 0x68) |
| XDA, XCL, INT | not connected |

No code change and no re-flashing needed. With an MPU6050 the firmware also uses the gyroscope
(complementary filter), so steering gets smoother and reacts faster. Run **Calibrate** again after swapping.
MPU6500 / MPU9250 boards and common clones are detected too.
