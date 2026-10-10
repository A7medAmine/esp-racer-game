// ESP Racer controller firmware
// ESP8266 (NodeMCU) + ADXL345 or MPU6050 tilt sensor + analog joystick.
//
// Streams controller state as text lines over USB serial (always) and over
// WiFi WebSocket (when enabled). Full protocol: docs/protocol.md
//
//   D,<seq>,<roll x10>,<pitch x10>,<joy -1000..1000>,<button 0/1>,<flags>
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
// Button state (debounced)
bool btnStable = false;
bool btnLastRaw = false;
uint32_t btnChangedAt = 0;

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

bool readButton() {
  bool raw = digitalRead(PIN_JOY_BTN) == LOW;
  uint32_t now = millis();
  if (raw != btnLastRaw) {
    btnLastRaw = raw;
    btnChangedAt = now;
  }
  if (now - btnChangedAt >= BTN_DEBOUNCE_MS) btnStable = raw;
  return btnStable;
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
    sendLine("# Commands: PING | INFO | CALJOY | RATE <10-100> | WIFI MODE <OFF|AP|STA>");
    sendLine("#   WIFI SSID <name> | WIFI PASS <password> | WIFI APSSID <name> | WIFI APPASS <8+ chars>");
    sendLine("#   WIFI APPLY (save + restart WiFi) | RESET (factory defaults) | REBOOT");
  } else if (cmd == "CALJOY") {
    calibrateJoystick();
    sendLine("OK CALJOY " + String(joyCenter));
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
  bool btn = readButton();
  uint8_t flags = tilt.ok() ? 1 : 0;

  char buf[64];
  snprintf(buf, sizeof(buf), "D,%lu,%d,%d,%d,%d,%u", (unsigned long)seq++,
           (int)lroundf(tilt.roll() * 10), (int)lroundf(tilt.pitch() * 10), joy, btn ? 1 : 0, flags);
  Serial.println(buf);
  netBroadcast(buf);
}
