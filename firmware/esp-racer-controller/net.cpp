#include "net.h"

#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>
#include <ESP8266mDNS.h>
#include <WebSocketsServer.h>

#include "config.h"
#include "settings_store.h"

namespace {

enum State : uint8_t { ST_OFF, ST_AP, ST_CONNECTING, ST_STA, ST_AP_FALLBACK };

WebSocketsServer ws(WS_PORT);
ESP8266WebServer http(HTTP_PORT);
LineHandler commandHandler = nullptr;
State state = ST_OFF;
uint32_t connectStart = 0;
bool mdnsStarted = false;

void startAp() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP(settings.apSsid, settings.apPass);
}

void onWsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED:
      ws.sendTXT(num, "# hello from ESP Racer controller");
      break;
    case WStype_TEXT:
      if (commandHandler) {
        String line;
        line.reserve(length);
        for (size_t i = 0; i < length; i++) line += (char)payload[i];
        commandHandler(line);
      }
      break;
    default:
      break;
  }
}

void handleRoot() {
  String ip = netIp();
  String html =
      "<!doctype html><meta name=viewport content='width=device-width'>"
      "<title>ESP Racer</title><body style='font-family:sans-serif;background:#111;color:#eee;padding:20px'>"
      "<h1>ESP Racer controller</h1><p>Firmware " FW_VERSION "</p>"
      "<p>WiFi mode: <b>";
  html += netState();
  html += "</b><br>IP: <b>" + ip + "</b><br>WebSocket: <b>ws://" + ip + ":" + String(WS_PORT) +
          "</b><br>Clients: <b>" + String(ws.connectedClients()) + "</b></p>"
          "<p>In the game choose <i>Connect WiFi</i> and enter <b>" + ip + "</b>.</p></body>";
  http.send(200, "text/html", html);
}

}  // namespace

void netBegin(LineHandler onCommand) {
  commandHandler = onCommand;
  WiFi.persistent(false);  // we store credentials ourselves
  ws.begin();
  ws.onEvent(onWsEvent);
  http.on("/", handleRoot);
  http.begin();
  netApply();
}

void netApply() {
  if (mdnsStarted) {
    MDNS.end();
    mdnsStarted = false;
  }
  WiFi.disconnect(true);
  WiFi.softAPdisconnect(true);

  switch (settings.wifiMode) {
    case NET_AP:
      startAp();
      state = ST_AP;
      break;
    case NET_STA:
      if (settings.staSsid[0] == '\0') {
        startAp();
        state = ST_AP_FALLBACK;
        break;
      }
      WiFi.mode(WIFI_STA);
      WiFi.hostname(MDNS_HOSTNAME);
      WiFi.begin(settings.staSsid, settings.staPass);
      connectStart = millis();
      state = ST_CONNECTING;
      break;
    default:
      WiFi.mode(WIFI_OFF);
      state = ST_OFF;
      return;
  }
  // Disabling modem sleep keeps WiFi latency low and steady.
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
}

void netLoop() {
  if (state == ST_OFF) return;

  if (state == ST_CONNECTING) {
    if (WiFi.status() == WL_CONNECTED) {
      state = ST_STA;
      mdnsStarted = MDNS.begin(MDNS_HOSTNAME);
      if (mdnsStarted) {
        MDNS.addService("http", "tcp", HTTP_PORT);
        MDNS.addService("ws", "tcp", WS_PORT);
      }
      Serial.print("# WiFi connected, IP ");
      Serial.println(WiFi.localIP());
    } else if (millis() - connectStart > STA_CONNECT_TIMEOUT_MS) {
      // Could not join the home network: open our own AP so the user is never locked out.
      Serial.println("# WiFi join failed, falling back to access point");
      startAp();
      state = ST_AP_FALLBACK;
    }
  } else if (state == ST_STA && WiFi.status() != WL_CONNECTED) {
    connectStart = millis();
    state = ST_CONNECTING;  // the SDK reconnects on its own
  }

  if (mdnsStarted) MDNS.update();
  ws.loop();
  http.handleClient();
}

void netBroadcast(const char* line) {
  if (state == ST_OFF || ws.connectedClients() == 0) return;
  ws.broadcastTXT(line);
}

bool netHasClients() { return state != ST_OFF && ws.connectedClients() > 0; }

const char* netState() {
  switch (state) {
    case ST_AP: return "ap";
    case ST_CONNECTING: return "connecting";
    case ST_STA: return "sta";
    case ST_AP_FALLBACK: return "ap-fallback";
    default: return "off";
  }
}

String netIp() {
  if (state == ST_STA) return WiFi.localIP().toString();
  if (state == ST_AP || state == ST_AP_FALLBACK) return WiFi.softAPIP().toString();
  return "";
}
