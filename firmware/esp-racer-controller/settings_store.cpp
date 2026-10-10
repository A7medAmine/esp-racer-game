#include "settings_store.h"

#include <EEPROM.h>

#include "config.h"

// Bump the low byte when the Settings layout changes so old data is discarded.
static const uint32_t SETTINGS_MAGIC = 0x52414301;  // "RAC" + version 1

Settings settings;

static void copyStr(char* dst, const char* src, size_t size) {
  strncpy(dst, src, size - 1);
  dst[size - 1] = '\0';
}

void settingsReset() {
  memset(&settings, 0, sizeof(settings));
  settings.magic = SETTINGS_MAGIC;
  settings.wifiMode = DEFAULT_WIFI_MODE;
  settings.streamHz = DEFAULT_STREAM_HZ;
  copyStr(settings.staSsid, DEFAULT_STA_SSID, sizeof(settings.staSsid));
  copyStr(settings.staPass, DEFAULT_STA_PASS, sizeof(settings.staPass));
  copyStr(settings.apSsid, DEFAULT_AP_SSID, sizeof(settings.apSsid));
  copyStr(settings.apPass, DEFAULT_AP_PASS, sizeof(settings.apPass));
}

void settingsLoad() {
  EEPROM.begin(sizeof(Settings));
  EEPROM.get(0, settings);
  bool valid = settings.magic == SETTINGS_MAGIC && settings.wifiMode <= NET_STA &&
               settings.streamHz >= 10 && settings.streamHz <= 100;
  if (!valid) {
    settingsReset();
    settingsSave();
    return;
  }
  // Guarantee termination even if flash content is odd.
  settings.staSsid[sizeof(settings.staSsid) - 1] = '\0';
  settings.staPass[sizeof(settings.staPass) - 1] = '\0';
  settings.apSsid[sizeof(settings.apSsid) - 1] = '\0';
  settings.apPass[sizeof(settings.apPass) - 1] = '\0';
}

void settingsSave() {
  EEPROM.put(0, settings);
  EEPROM.commit();
}

const char* wifiModeName(uint8_t mode) {
  switch (mode) {
    case NET_AP: return "AP";
    case NET_STA: return "STA";
    default: return "OFF";
  }
}
