// ============================================================
//  Trivial Robots : ESP32 MAÎTRE
//  - Crée le point d'accès WiFi pour la tablette
//  - Serveur WebSocket (port 81) qui reçoit les commandes texte
//  - Relaie les commandes aux 6 robots en ESP-NOW (broadcast)
//
//  Bibliothèque requise : "WebSockets" de Markus Sattler (links2004)
//  Compatible cœur Arduino-ESP32 2.x et 3.x
// ============================================================
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_arduino_version.h>
#include <ArduinoOTA.h>
#include <WebSocketsServer.h>
#include <trivial_protocol.h>   // firmware/lib/TrivialProtocol

// 1er argument du callback de réception ESP-NOW selon la version du cœur.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
typedef const esp_now_recv_info_t* RecvSource;
#else
typedef const uint8_t* RecvSource;
#endif

// ---------- Réglages ----------
const char* AP_SSID  = "TrivialRobots";
const char* AP_PASS  = "trivial2026";  // 8 caractères minimum
const char* OTA_PASS = "trivial-ota-2026";
const char* OTA_HOSTNAME = "trivial-master";
const int   WS_PORT = 81;
const int   LED_PIN = 2;               // LED intégrée (la plupart des DevKit)

WebSocketsServer ws(WS_PORT);
const uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
uint8_t seqNum = 0;

// Dernière réception d'un heartbeat (ou ACK) par robot (index 1..TR_ROBOT_COUNT).
volatile uint32_t lastSeen[TR_ROBOT_COUNT + 1] = {0};
uint32_t lastStatusBroadcast = 0;

// ---------- Suivi des commandes en attente d'ACK ----------
// Chaque entrée = commande envoyée à UN robot, en attente d'accusé de réception.
// Les commandes ALL ne sont pas suivies (coût trop élevé, impact plus faible).
#define PENDING_SIZE 8
struct Pending {
  bool     active;
  uint8_t  seq;
  uint8_t  target;   // 1..6
  uint8_t  cmd;
  uint32_t lastSent;
  uint8_t  attempts; // nombre total d'émissions (la première comprise)
};
Pending pending[PENDING_SIZE];

void trackPending(uint8_t seq, uint8_t target, uint8_t cmd) {
  for (int i = 0; i < PENDING_SIZE; i++) {
    if (!pending[i].active) {
      pending[i] = {true, seq, target, cmd, millis(), 1};
      return;
    }
  }
  Serial.println("[ACK] pending plein, commande non suivie");
}

void handleAck(uint8_t src, uint8_t seq) {
  for (int i = 0; i < PENDING_SIZE; i++) {
    if (pending[i].active && pending[i].seq == seq && pending[i].target == src) {
      pending[i].active = false;
      return;
    }
  }
}

// Retransmet les commandes dont l'ACK tarde. Après TR_ACK_MAX_TRIES tentatives,
// abandonne et prévient la tablette via "NACK <robot> <cmd>".
void retransmitPending() {
  uint32_t now = millis();
  for (int i = 0; i < PENDING_SIZE; i++) {
    if (!pending[i].active) continue;
    if (now - pending[i].lastSent < TR_ACK_TIMEOUT_MS) continue;
    if (pending[i].attempts >= TR_ACK_MAX_TRIES) {
      char msg[24];
      snprintf(msg, sizeof(msg), "NACK %u %u", pending[i].target, pending[i].cmd);
      Serial.printf("[ACK] abandon : %s\n", msg);
      ws.broadcastTXT(msg);
      pending[i].active = false;
      continue;
    }
    TrPacket p = {TR_MAGIC, pending[i].target, pending[i].cmd, pending[i].seq};
    for (int r = 0; r < TR_REPEAT; r++) {
      esp_now_send(BROADCAST, (const uint8_t*)&p, sizeof(p));
      delay(4);
    }
    pending[i].lastSent = now;
    pending[i].attempts++;
    Serial.printf("[ACK] retransmission robot=%u seq=%u try=%u\n",
                  pending[i].target, pending[i].seq, pending[i].attempts);
  }
}

// ---------- ESP-NOW ----------
bool sendToRobots(uint8_t target, uint8_t cmd) {
  TrPacket p;
  p.magic  = TR_MAGIC;
  p.target = target;
  p.cmd    = cmd;
  p.seq    = ++seqNum;
  bool ok = true;
  for (int i = 0; i < TR_REPEAT; i++) {
    if (esp_now_send(BROADCAST, (const uint8_t*)&p, sizeof(p)) != ESP_OK) ok = false;
    delay(4);
  }
  digitalWrite(LED_PIN, HIGH); delay(10); digitalWrite(LED_PIN, LOW);
  if (target != TR_TARGET_ALL) trackPending(p.seq, target, cmd);
  Serial.printf("[ESPNOW] target=%u cmd=%u seq=%u %s\n", target, cmd, p.seq, ok ? "OK" : "ERR");
  return ok;
}

// ---------- Réception ESP-NOW (heartbeats + ACK des robots) ----------
void onEspNowRecv(RecvSource src, const uint8_t* data, int len) {
  (void)src;
  if (len != (int)sizeof(TrPacket)) return;
  TrPacket p;
  memcpy(&p, data, sizeof(p));
  if (p.magic != TR_MAGIC) return;
  if (p.cmd != TR_CMD_HEARTBEAT && p.cmd != TR_CMD_ACK) return;
  if (p.target < 1 || p.target > TR_ROBOT_COUNT) return;
  lastSeen[p.target] = millis();   // une liaison active vaut un heartbeat
  if (p.cmd == TR_CMD_ACK) handleAck(p.target, p.seq);
}

// Construit "STATUS 1,0,1,1,0,1" : 1 si robot vu < TR_ONLINE_MS, 0 sinon.
void buildStatus(char* out, size_t cap) {
  size_t n = 0;
  int w = snprintf(out + n, cap - n, "STATUS ");
  if (w > 0) n += (size_t)w;
  uint32_t now = millis();
  for (uint8_t i = 1; i <= TR_ROBOT_COUNT; i++) {
    bool on = lastSeen[i] != 0 && (now - lastSeen[i] < TR_ONLINE_MS);
    w = snprintf(out + n, cap - n, "%s%d", i > 1 ? "," : "", on ? 1 : 0);
    if (w > 0) n += (size_t)w;
  }
}

// Diffuse STATUS à tous les clients WebSocket.
void broadcastStatus() {
  char msg[48];
  buildStatus(msg, sizeof(msg));
  ws.broadcastTXT(msg);
}

// ---------- Parsing des commandes texte ----------
// MOVE <id> <UP|DOWN|LEFT|RIGHT>   ANIM [id]   WIN <id>   STOP [id]   PING
int parseTarget(const String& s) {
  if (s.length() == 0 || s == "ALL") return TR_TARGET_ALL;
  int id = s.toInt();
  return (id >= 1 && id <= 6) ? id : -1;
}

int parseDir(const String& s) {
  if (s == "UP")    return TR_CMD_UP;
  if (s == "DOWN")  return TR_CMD_DOWN;
  if (s == "LEFT")  return TR_CMD_LEFT;
  if (s == "RIGHT") return TR_CMD_RIGHT;
  return -1;
}

String handleCommand(String line) {
  line.trim();
  line.toUpperCase();
  int sp1 = line.indexOf(' ');
  String verb = sp1 < 0 ? line : line.substring(0, sp1);
  String rest = sp1 < 0 ? "" : line.substring(sp1 + 1);
  rest.trim();
  int sp2 = rest.indexOf(' ');
  String a1 = sp2 < 0 ? rest : rest.substring(0, sp2);
  String a2 = sp2 < 0 ? "" : rest.substring(sp2 + 1);
  a2.trim();

  if (verb == "PING") return "PONG";

  if (verb == "MOVE") {
    int t = parseTarget(a1), d = parseDir(a2);
    if (t < 0 || d < 0) return "ERR bad MOVE";
    return sendToRobots(t, d) ? "OK" : "ERR espnow";
  }
  if (verb == "ANIM" || verb == "STOP" || verb == "WIN") {
    int t = parseTarget(a1);
    if (t < 0) return "ERR bad target";
    uint8_t c = verb == "ANIM" ? TR_CMD_ANIM : verb == "STOP" ? TR_CMD_STOP : TR_CMD_WIN;
    return sendToRobots(t, c) ? "OK" : "ERR espnow";
  }
  return "ERR unknown";
}

// ---------- WebSocket ----------
void onWsEvent(uint8_t num, WStype_t type, uint8_t* payload, size_t length) {
  switch (type) {
    case WStype_CONNECTED: {
      Serial.printf("[WS] client %u connecte\n", num);
      ws.sendTXT(num, "HELLO TRIVIAL-MASTER 1");
      char msg[48];
      buildStatus(msg, sizeof(msg));
      ws.sendTXT(num, msg);
      break;
    }
    case WStype_DISCONNECTED:
      Serial.printf("[WS] client %u deconnecte\n", num);
      break;
    case WStype_TEXT: {
      String msg;
      msg.reserve(length);
      for (size_t i = 0; i < length; i++) msg += (char)payload[i];
      String reply = handleCommand(msg);
      Serial.printf("[WS] <- %s  -> %s\n", msg.c_str(), reply.c_str());
      ws.sendTXT(num, reply);
      break;
    }
    default:
      break;
  }
}

// ---------- Setup / loop ----------
void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);

  WiFi.mode(WIFI_AP_STA);
  // 8 clients max : 1 tablette + 6 robots (pour OTA) + marge.
  WiFi.softAP(AP_SSID, AP_PASS, TR_WIFI_CHANNEL, 0, 8);
  Serial.printf("AP \"%s\" sur canal %d, IP %s\n", AP_SSID, TR_WIFI_CHANNEL,
                WiFi.softAPIP().toString().c_str());

  if (esp_now_init() != ESP_OK) {
    Serial.println("ERREUR esp_now_init, redemarrage");
    delay(1000);
    ESP.restart();
  }
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = TR_WIFI_CHANNEL;
  peer.ifidx   = WIFI_IF_AP;
  peer.encrypt = false;
  esp_now_add_peer(&peer);
  esp_now_register_recv_cb(onEspNowRecv);

  seqNum = (uint8_t)esp_random();   // évite les collisions de seq après un reboot

  ws.begin();
  ws.onEvent(onWsEvent);
  Serial.printf("WebSocket pret sur ws://%s:%d\n", WiFi.softAPIP().toString().c_str(), WS_PORT);

  // ---------- OTA ----------
  ArduinoOTA.setHostname(OTA_HOSTNAME);
  ArduinoOTA.setPassword(OTA_PASS);
  ArduinoOTA.onStart([]() { Serial.println("[OTA] debut"); });
  ArduinoOTA.onEnd([]()  { Serial.println("[OTA] fin"); });
  ArduinoOTA.onError([](ota_error_t err) { Serial.printf("[OTA] erreur %u\n", err); });
  ArduinoOTA.begin();
  Serial.printf("OTA pret, hostname %s\n", OTA_HOSTNAME);
}

void loop() {
  ws.loop();
  ArduinoOTA.handle();
  retransmitPending();

  // Diffuse l'état des robots environ une fois par seconde.
  uint32_t now = millis();
  if (now - lastStatusBroadcast >= TR_HEARTBEAT_MS) {
    lastStatusBroadcast = now;
    broadcastStatus();
  }

  // Commandes de test depuis le moniteur série (ex: "MOVE 1 UP", "ANIM")
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    Serial.println(handleCommand(line));
  }
}
