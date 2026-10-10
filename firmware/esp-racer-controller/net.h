// WiFi transport: access point or station mode, a WebSocket server that
// streams the same text lines as USB serial, and a tiny status web page.
#pragma once
#include <Arduino.h>

typedef void (*LineHandler)(const String& line);

void netBegin(LineHandler onCommand);
void netLoop();
// (Re)starts WiFi using the current settings.
void netApply();
// Sends one text line to every connected WebSocket client.
void netBroadcast(const char* line);
bool netHasClients();
// Human readable state for INFO: "off", "ap", "sta", "connecting", "ap-fallback".
const char* netState();
String netIp();
