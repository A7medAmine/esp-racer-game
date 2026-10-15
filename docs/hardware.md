# Hardware: parts, pinout and wiring

![Wiring diagram](wiring.svg)

## Parts list

| Part | Notes |
|---|---|
| NodeMCU v2 / v3 (ESP8266, ESP-12E) | Any NodeMCU works. A Wemos D1 mini also works (same pin labels). |
| ADXL345 accelerometer module (GY-291) | Tilt steering. Can be swapped for an MPU6050 later, see below. |
| Analog joystick module (KY-023 or similar) | Gas / brake / reverse on the Y axis, nitro on the push button. Optional if you use paddles. |
| Optional: 2 push buttons or lever microswitches | Gas and brake paddles (firmware 1.1+). Lever microswitches (KW11 style) survive heavy use best. |
| Optional: 1 push button | Separate nitro button on the breadboard (wired in parallel with the joystick button). |
| Optional: phone vibration motor + NPN transistor (2N2222, S8050 or BC337) + 1 kΩ resistor + 1N4148 diode + 100 µF capacitor | Vibration feedback (firmware 1.1+). See [Vibration motor](#vibration-motor-optional). |
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

### Paddles and nitro button (optional, firmware 1.1+)

![Wiring of the optional extras](wiring-extras.svg)

Each button has one leg on the pin and the other on **GND**. No resistors: the firmware uses the internal pull-ups.

| Button | NodeMCU pin | Why |
|---|---|---|
| Gas paddle | **D6** (GPIO12) | Hold = full gas (the game ramps it in over ~0.1 s) |
| Brake paddle | **D7** (GPIO13) | Hold = brake, then reverse when stopped |
| Nitro button | **D5** (GPIO14) | Same pin as the joystick SW. Wire it in parallel if both are present |
| Other leg of every button | **GND** | |

Then set **Controller > Tuning > Gas / brake** in the game:

- **Joystick**: the stick drives gas and brake. Paddles still work too if they're wired, so you can mix.
- **Paddles**: only the paddles drive gas and brake. Use this when no joystick is wired, because an
  unconnected A0 picks up noise that would look like stick movement.

Pins that have nothing wired read "not pressed", so firmware 1.1 works on a joystick-only controller unchanged.

### Vibration motor (optional)

A phone vibration motor draws 60 to 100 mA. An ESP8266 pin can only give about 12 mA, so the pin switches a
transistor and the transistor switches the motor. **Never wire the motor straight to a pin.**

| From | To | Why |
|---|---|---|
| NodeMCU **D0** (GPIO16) | 1 kΩ resistor, then the transistor's **base** | Switches the transistor; the resistor limits the base current |
| Transistor **emitter** | **GND** | |
| Transistor **collector** | Motor **−** (black/blue wire) | |
| Motor **+** (red wire) | **3V3** | Phone motors are rated about 3 V |
| 1N4148 diode | Across the motor: striped end (cathode) to **3V3**, other end to the collector | Absorbs the voltage spike when the motor switches off; without it the transistor or ESP can die |
| 100 µF capacitor | Between **3V3** (+) and **GND** (−), close to the motor | Stops the ESP8266 from resetting when the motor starts |

Transistor pin order (looking at the flat side, legs down): 2N2222 and S8050 are usually **E B C**, BC337 is
**C B E**. Check your part's datasheet if unsure.

The game controls the strength with PWM (`VIB <0-100> <ms>`, see [protocol.md](protocol.md)) and buzzes on
crashes, nitro, grass, the countdown and the finish. **Controller > Tuning > Vibration** sets Off / Low / High,
and **Test vibration** gives a short buzz to check the wiring. Hot glue the motor inside the grip, close to
where the hands are. The motor may twitch for a moment while the board boots: that's normal.

### Pin summary

| NodeMCU pin | Used for |
|---|---|
| D1, D2 | Tilt sensor (I2C) |
| A0 | Joystick Y |
| D5 | Nitro (joystick SW and/or breadboard button) |
| D6 | Gas paddle |
| D7 | Brake paddle |
| D0 | Vibration motor (through the transistor) |
| D4 | On-board status LED |
| D3, D8 | Free, but avoid (boot pins) |

### Status LED (on-board, nothing to wire)

| Blue LED on the NodeMCU | Meaning |
|---|---|
| Short blink every second | Running normally |
| Fast blinking | Tilt sensor not found: check SDA/SCL/VCC/GND |
| Solid on | A game is connected over WiFi |

### Pins to avoid

D3 (GPIO0), D4 (GPIO2) and D8 (GPIO15) decide how the ESP8266 boots. Keep buttons and sensors off them.
D4 also drives the blue LED. RX and TX carry the USB serial link, so they're taken too.

## Assembly tips

1. Wire everything **with the USB cable unplugged**.
2. Mount the ADXL345 flat and firmly (hot glue or double-sided tape) on whatever you hold: a piece of
   cardboard, a 3D-printed wheel, a plastic box. If it wobbles, steering will jitter.
3. Paddles: mount them behind the wheel like F1 shift paddles (right = gas, left = brake) or on a block on
   the floor as foot pedals. Use longer wires for those, twisted together, but keep the I2C wires short.
4. Mount the joystick so that "up" is natural for your thumb. Which way is "up" doesn't matter:
   the game's calibration detects it.
5. Orientation of the sensor doesn't matter either. Run **Controller > Calibrate** in the game once and
   it figures out the steering axis and direction.
6. Keep the I2C wires (SDA/SCL) short, ideally under 20 cm.

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
