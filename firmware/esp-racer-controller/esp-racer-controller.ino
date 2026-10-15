// ESP Racer controller firmware
// ESP8266 (NodeMCU) + ADXL345 or MPU6050 tilt sensor + analog joystick and/or
// gas and brake paddles, a nitro button and a vibration motor.
//
// Streams controller state as text lines over USB serial (always) and over
// WiFi WebSocket (when enabled). Full protocol: docs/protocol.md
//
//   D,<seq>,<roll x10>,<pitch x10>,<joy -1000..1000>,<nitro 0/1>,<flags>,<gas 0/1>,<brake 0/1>
//
// Wiring: docs/wiring.md. Build: open this folder in Arduino IDE, or run
// PlatformIO from the firmware/ folder.

#include "config.h"
#include "net.h"
#include "settings_store.h"
#include "tilt_sensor.h"

TiltSensor tilt;

// Joystick state
int joyCenter = 512;
float joyFiltered = 512;
// Debounced push button, pressed = pin pulled to GND.
struct Button {
  uint8_t pin;
  bool stable;
  bool lastRaw;
  uint32_t changedAt;

  bool read() {
    bool raw = digitalRead(pin) == LOW;
    uint32_t now = millis();
    if (raw != lastRaw) {
      lastRaw = raw;
      changedAt = now;
    }
    if (now - changedAt >= BTN_DEBOUNCE_MS) stable = raw;
    return stable;
  }
};
Button nitroBtn = {PIN_JOY_BTN, false, false, 0};
Button gasBtn = {PIN_GAS, false, false, 0};
Button brakeBtn = {PIN_BRAKE, false, false, 0};

// Vibration motor: the game asks for a strength and a duration; the motor stops
// by itself when the time runs out, even if the game or the WiFi link dies.
uint8_t vibStrength = 0;    // 0..100
uint32_t vibUntil = 0;      // millis() when the current pulse ends

uint32_t seq = 0;
uint32_t lastFrameUs = 0;
uint32_t lastSensorRetry = 0;
String serialLine;

// ---------------------------------------------------------------------------
// Output helpers: every reply goes to USB and WiFi so both stay in sync.
// ---------------------------------------------------------------------------
void sendLine(const String& line) {
  Serial.println(line);
  netBroadcast(line.c_str());
}

String jsonEscape(const char* s) {
  String out;
  for (; *s; s++) {
    if (*s == '"' || *s == '\\') out += '\\';
    if ((uint8_t)*s >= 0x20) out += *s;
  }
  return out;
}

void sendInfo() {
  char addr[8];
  snprintf(addr, sizeof(addr), "0x%02X", tilt.address());
  String j = "I {\"fw\":\"" FW_VERSION "\",\"sensor\":\"";
  j += tilt.name();
  j += "\",\"sensorAddr\":\"";
  j += addr;
  j += "\",\"sensorOk\":";
  j += tilt.ok() ? "true" : "false";
  j += ",\"wifiMode\":\"";
  j += wifiModeName(settings.wifiMode);
  j += "\",\"wifiState\":\"";
  j += netState();
  j += "\",\"ip\":\"";
  j += netIp();
  j += "\",\"wsPort\":" + String(WS_PORT);
  j += ",\"apSsid\":\"" + jsonEscape(settings.apSsid);
  j += "\",\"apPass\":\"" + jsonEscape(settings.apPass);
  j += "\",\"staSsid\":\"" + jsonEscape(settings.staSsid);
  j += "\",\"hz\":" + String(settings.streamHz);
  j += ",\"joyCenter\":" + String(joyCenter);
  j += ",\"caps\":[\"pedals\",\"haptics\"]";
  j += "}";
  sendLine(j);
}

// ---------------------------------------------------------------------------
// Joystick and button
// ---------------------------------------------------------------------------
void calibrateJoystick() {
  long sum = 0;
  for (int i = 0; i < 32; i++) {
    sum += analogRead(PIN_JOY_Y);
    delay(2);
  }
  joyCenter = constrain(sum / 32, 200, 823);
  joyFiltered = joyCenter;
}

int readJoystick() {
  joyFiltered += (analogRead(PIN_JOY_Y) - joyFiltered) * (1.0f - JOY_SMOOTHING);
  float v = joyFiltered >= joyCenter ? (joyFiltered - joyCenter) / (1023.0f - joyCenter)
                                     : (joyFiltered - joyCenter) / (float)joyCenter;
  float mag = fabsf(v);
  if (mag < JOY_DEADZONE) return 0;
  mag = min(1.0f, (mag - JOY_DEADZONE) / (1.0f - JOY_DEADZONE));
  return (int)(copysignf(mag, v) * 1000);
}

// ---------------------------------------------------------------------------
// Vibration motor
// ---------------------------------------------------------------------------
void setVibration(int strength, uint32_t ms) {
  vibStrength = constrain(strength, 0, 100);
  vibUntil = millis() + ms;
  analogWrite(PIN_VIBRATION, vibStrength);
}

void updateVibration() {
  if (vibStrength && (int32_t)(millis() - vibUntil) >= 0) {
    vibStrength = 0;
    analogWrite(PIN_VIBRATION, 0);
  }
}

// ---------------------------------------------------------------------------
// Commands (from USB serial or WebSocket). See docs/protocol.md.
// ---------------------------------------------------------------------------
void handleCommand(const String& rawLine) {
  String line = rawLine;
  line.trim();
  if (line.length() == 0) return;

  int sp = line.indexOf(' ');
  String cmd = sp < 0 ? line : line.substring(0, sp);
  String arg = sp < 0 ? "" : line.substring(sp + 1);
  cmd.toUpperCase();
  arg.trim();

  if (cmd == "PING") {
    sendLine("OK PONG");
  } else if (cmd == "INFO") {
    sendInfo();
  } else if (cmd == "HELP") {
    sendLine("# Commands: PING | INFO | CALJOY | RATE <10-100> | VIB <0-100> [ms] | WIFI MODE <OFF|AP|STA>");
    sendLine("#   WIFI SSID <name> | WIFI PASS <password> | WIFI APSSID <name> | WIFI APPASS <8+ chars>");
    sendLine("#   WIFI APPLY (save + restart WiFi) | RESET (factory defaults) | REBOOT");
  } else if (cmd == "CALJOY") {
    calibrateJoystick();
    sendLine("OK CALJOY " + String(joyCenter));
  } else if (cmd == "VIB") {
    // Sent many times per second by the game, so success is silent (no OK line).
    int sp2 = arg.indexOf(' ');
    String s = sp2 < 0 ? arg : arg.substring(0, sp2);
    long ms = sp2 < 0 ? VIB_DEFAULT_MS : arg.substring(sp2 + 1).toInt();
    if (s.length() == 0 || ms < 0) {
      sendLine("ERR VIB <0-100> [ms]");
      return;
    }
    setVibration(s.toInt(), min(ms, (long)VIB_MAX_MS));
  } else if (cmd == "RATE") {
    int hz = arg.toInt();
    if (hz < 10 || hz > 100) {
      sendLine("ERR RATE must be 10..100");
      return;
    }
    settings.streamHz = hz;
    settingsSave();
    sendLine("OK RATE " + String(hz));
  } else if (cmd == "WIFI") {
    int sp2 = arg.indexOf(' ');
    String sub = sp2 < 0 ? arg : arg.substring(0, sp2);
    String val = sp2 < 0 ? "" : arg.substring(sp2 + 1);
    sub.toUpperCase();
    if (sub == "MODE") {
      val.toUpperCase();
      if (val == "OFF") settings.wifiMode = NET_OFF;
      else if (val == "AP") settings.wifiMode = NET_AP;
      else if (val == "STA") settings.wifiMode = NET_STA;
      else {
        sendLine("ERR WIFI MODE must be OFF, AP or STA");
        return;
      }
      sendLine("OK WIFI MODE " + val + " (send WIFI APPLY to activate)");
    } else if (sub == "SSID") {
      val.toCharArray(settings.staSsid, sizeof(settings.staSsid));
      sendLine("OK WIFI SSID");
    } else if (sub == "PASS") {
      val.toCharArray(settings.staPass, sizeof(settings.staPass));
      sendLine("OK WIFI PASS");
    } else if (sub == "APSSID") {
      if (val.length() == 0) {
        sendLine("ERR APSSID cannot be empty");
        return;
      }
      val.toCharArray(settings.apSsid, sizeof(settings.apSsid));
      sendLine("OK WIFI APSSID");
    } else if (sub == "APPASS") {
      if (val.length() < 8) {
        sendLine("ERR APPASS needs at least 8 characters");
        return;
      }
      val.toCharArray(settings.apPass, sizeof(settings.apPass));
      sendLine("OK WIFI APPASS");
    } else if (sub == "APPLY") {
      settingsSave();
      sendLine("OK WIFI APPLY");
      netApply();
      sendInfo();
    } else {
      sendLine("ERR unknown WIFI command, send HELP");
    }
  } else if (cmd == "RESET") {
    settingsReset();
    settingsSave();
    sendLine("OK RESET");
    netApply();
    sendInfo();
  } else if (cmd == "REBOOT") {
    sendLine("OK REBOOT");
    delay(100);
    ESP.restart();
  } else {
    sendLine("ERR unknown command '" + cmd + "', send HELP");
  }
}

void readSerialCommands() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (serialLine.length()) handleCommand(serialLine);
      serialLine = "";
    } else if (serialLine.length() < 160) {
      serialLine += c;
    }
  }
}

// ---------------------------------------------------------------------------
// Status LED: fast blink = no tilt sensor, solid = WiFi client connected,
// short heartbeat every second = running normally.
// ---------------------------------------------------------------------------
void updateLed() {
  uint32_t t = millis();
  bool on;
  if (!tilt.ok()) on = (t / 100) % 2;
  else if (netHasClients()) on = true;
  else on = (t % 1000) < 60;
  digitalWrite(PIN_STATUS_LED, (on ^ STATUS_LED_ACTIVE_LOW) ? HIGH : LOW);
}

// ---------------------------------------------------------------------------
void setup() {
  Serial.begin(SERIAL_BAUD);
  serialLine.reserve(160);
  pinMode(PIN_JOY_BTN, INPUT_PULLUP);
  pinMode(PIN_GAS, INPUT_PULLUP);
  pinMode(PIN_BRAKE, INPUT_PULLUP);
  pinMode(PIN_VIBRATION, OUTPUT);
  analogWriteRange(100);  // VIB strength 0..100 maps straight to the PWM duty
  analogWriteFreq(1000);
  analogWrite(PIN_VIBRATION, 0);
  pinMode(PIN_STATUS_LED, OUTPUT);
  delay(50);
  Serial.println();
  Serial.println("# ESP Racer controller " FW_VERSION);

  settingsLoad();
  if (tilt.begin()) {
    Serial.printf("# Tilt sensor: %s at 0x%02X\n", tilt.name(), tilt.address());
  } else {
    Serial.println("# WARNING: no tilt sensor found. Check SDA->D2, SCL->D1, VCC, GND (docs/wiring.md)");
  }
  calibrateJoystick();
  Serial.printf("# Joystick center: %d (keep the stick released while booting)\n", joyCenter);

  netBegin(handleCommand);
  sendInfo();
}

void loop() {
  readSerialCommands();
  netLoop();
  updateLed();
  updateVibration();

  uint32_t now = micros();
  uint32_t frameUs = 1000000UL / settings.streamHz;
  if (now - lastFrameUs < frameUs) return;
  lastFrameUs = now;

  if (!tilt.ok() && millis() - lastSensorRetry > 1000) {
    lastSensorRetry = millis();
    if (tilt.begin()) sendInfo();
  }
  tilt.update();

  int joy = readJoystick();
  bool nitro = nitroBtn.read();
  bool gas = gasBtn.read();
  bool brake = brakeBtn.read();
  uint8_t flags = tilt.ok() ? 1 : 0;

  char buf[72];
  snprintf(buf, sizeof(buf), "D,%lu,%d,%d,%d,%d,%u,%d,%d", (unsigned long)seq++,
           (int)lroundf(tilt.roll() * 10), (int)lroundf(tilt.pitch() * 10), joy, nitro ? 1 : 0, flags,
           gas ? 1 : 0, brake ? 1 : 0);
  Serial.println(buf);
  netBroadcast(buf);
}
