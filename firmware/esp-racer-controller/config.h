// ESP Racer controller - build-time configuration.
// Everything here has a sensible default; most users never need to edit this file.
// WiFi settings can be changed at runtime from the game (Settings > Controller)
// or with serial commands (see docs/protocol.md), no re-flashing needed.
#pragma once

#define FW_VERSION "1.0.0"

// ---------------------------------------------------------------------------
// Pins (NodeMCU / Wemos D1 mini labels)
// ---------------------------------------------------------------------------
// I2C bus shared by the tilt sensor (ADXL345 today, MPU6050 later).
#define PIN_SDA D2          // GPIO4
#define PIN_SCL D1          // GPIO5
// Joystick: only the Y axis is used (ESP8266 has a single analog input).
#define PIN_JOY_Y A0
// Joystick push button (SW). Pressed = connected to GND. Internal pull-up is used.
#define PIN_JOY_BTN D5      // GPIO14
// On-board blue LED (active LOW) used as a status light.
#define PIN_STATUS_LED D4   // GPIO2
#define STATUS_LED_ACTIVE_LOW 1

// ---------------------------------------------------------------------------
// Serial / streaming
// ---------------------------------------------------------------------------
#define SERIAL_BAUD 115200
#define DEFAULT_STREAM_HZ 60   // data frames per second (10..100)

// ---------------------------------------------------------------------------
// Joystick tuning
// ---------------------------------------------------------------------------
#define JOY_DEADZONE 0.06f        // fraction of travel ignored around center
#define JOY_SMOOTHING 0.5f        // 0 = no smoothing, 0.9 = very smooth
#define BTN_DEBOUNCE_MS 15

// ---------------------------------------------------------------------------
// Tilt tuning
// ---------------------------------------------------------------------------
#define TILT_SMOOTHING 0.35f      // low-pass factor for accelerometer angles
#define MPU_GYRO_WEIGHT 0.96f     // complementary filter weight (MPU6050 only)

// ---------------------------------------------------------------------------
// WiFi defaults (used on first boot and after the RESET command)
// ---------------------------------------------------------------------------
// Modes: 0 = off (USB only), 1 = access point (controller creates its own WiFi),
//        2 = station (controller joins your home WiFi)
#define DEFAULT_WIFI_MODE 1
#define DEFAULT_AP_SSID "ESP-Racer"
#define DEFAULT_AP_PASS "racer1234"   // must be 8+ characters
#define DEFAULT_STA_SSID ""
#define DEFAULT_STA_PASS ""
#define MDNS_HOSTNAME "esp-racer"     // reachable as esp-racer.local in station mode
#define WS_PORT 81
#define HTTP_PORT 80
#define STA_CONNECT_TIMEOUT_MS 15000  // fall back to AP mode if home WiFi fails
