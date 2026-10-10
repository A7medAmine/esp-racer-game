// Persistent settings kept in the ESP8266's emulated EEPROM (flash).
#pragma once
#include <Arduino.h>

enum NetMode : uint8_t { NET_OFF = 0, NET_AP = 1, NET_STA = 2 };

struct Settings {
  uint32_t magic;
  uint8_t wifiMode;
  uint8_t streamHz;
  char staSsid[33];
  char staPass[65];
  char apSsid[33];
  char apPass[65];
};

extern Settings settings;

void settingsLoad();
void settingsSave();
void settingsReset();  // restore defaults from config.h (not saved until settingsSave)
const char* wifiModeName(uint8_t mode);
