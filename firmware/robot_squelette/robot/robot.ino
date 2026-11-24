// ============================================================
//  Trivial Robots : ESP32 ROBOT - SQUELETTE À COMPLÉTER
//
//  Les fonctions marquées "TODO" sont à écrire par toi.
//  Le reste (WiFi, ESP-NOW, OTA, heartbeat, ACK) est déjà prêt :
//  si tu flashes le code tel quel, le robot démarre, la LED clignote
//  ID fois, il annonce sa présence au maître... mais il ne bouge pas
//  encore. À toi de lui apprendre !
//
//  Câblage prévu : driver moteurs à 2 entrées PWM (DRV8833, L9110S,
//  L298N avec ENA/ENB pontés). Chaque moteur : 2 broches ESP32 vers
//  IN1 et IN2 du driver.
//
//  Ordre conseillé :
//   1) motorRaw     -> faire tourner un moteur
//   2) motorL/R     -> raccourcis + prise en compte des INVERT_*
//   3) stopMotors   -> arrêt immédiat
//   4) drive        -> moteurs pendant X ms + stop
//   5) forwardCell / turnRight90 / turnLeft90
//   6) moveDir      -> pivoter dans la bonne direction puis avancer
//   7) animStart / animWin (bonus, libre)
// ============================================================
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_arduino_version.h>
#include <ArduinoOTA.h>
#include <trivial_protocol.h>   // firmware/lib/TrivialProtocol

// ---------- WiFi maître + OTA ----------
const char* MASTER_SSID = "TrivialRobots";
const char* MASTER_PASS = "trivial2026";
const char* OTA_PASS    = "trivial-ota-2026";

#if ESP_ARDUINO_VERSION_MAJOR >= 3
typedef const esp_now_recv_info_t* RecvSource;
#else
typedef const uint8_t* RecvSource;
#endif

// ---------- Identité ----------
#ifndef ROBOT_ID
#define ROBOT_ID 2          // écrasé par PlatformIO via -DROBOT_ID=N
#endif

// ---------- Câblage moteurs ----------
// Driver à 2 entrées PWM par moteur. Change les broches si ton câblage diffère.
const int L_IN1 = 25, L_IN2 = 26;
const int R_IN1 = 27, R_IN2 = 14;
const int LED_PIN = 2;

// ---------- Calibration (à ajuster après tests réels) ----------
int SPEED_L   = 200;        // 0..255, ajuster pour aller droit
int SPEED_R   = 200;
int TURN_SPEED = 180;
unsigned long CELL_MS   = 800;   // durée pour avancer d'UNE case
unsigned long TURN90_MS = 420;   // durée pour pivoter de 90°
unsigned long PAUSE_MS  = 120;   // pause entre deux mouvements
bool INVERT_L = false;           // inverser si un moteur tourne à l'envers
bool INVERT_R = false;

// ---------- État ----------
// Orientation absolue par rapport au plateau : 0=haut 1=droite 2=bas 3=gauche.
// Le robot doit être posé face au "haut" du plateau au démarrage.
int heading = 0;
QueueHandle_t cmdQueue;
volatile int lastSeq = -1;

// =============================================================
//  Réseau (fourni, ne pas modifier)
// =============================================================
const uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
uint8_t hbSeq = 0;
uint32_t lastHeartbeat = 0;

void sendHeartbeat() {
  TrPacket p;
  p.magic  = TR_MAGIC;
  p.target = ROBOT_ID;
  p.cmd    = TR_CMD_HEARTBEAT;
  p.seq    = ++hbSeq;
  esp_now_send(BROADCAST, (const uint8_t*)&p, sizeof(p));
  lastHeartbeat = millis();
}

void sendAck(uint8_t seq) {
  TrPacket a;
  a.magic  = TR_MAGIC;
  a.target = ROBOT_ID;
  a.cmd    = TR_CMD_ACK;
  a.seq    = seq;
  esp_now_send(BROADCAST, (const uint8_t*)&a, sizeof(a));
}

// =============================================================
//  À COMPLÉTER : contrôle moteurs
// =============================================================

// Pilote UN moteur à vitesse signée.
//   in1, in2 : les deux broches PWM du moteur (ex: L_IN1, L_IN2)
//   speed    : -255 (marche arrière à fond) à +255 (avant à fond), 0 = stop
//   invert   : si true, inverser le sens (moteur câblé à l'envers)
void motorRaw(int in1, int in2, int speed, bool invert) {

    if (invert) {
        speed -= speed;
    }

    speed = constrain(speed, -255, 255);

    if (speed >= 0) {
        analogWrite(in1, speed);
        analogWrite(in2, 0);
    }
    else {
        analogWrite(in1, 0);
        analogWrite(in2, -speed);
    }
}

// Pilote le moteur gauche en tenant compte de INVERT_L.
void motorL(int s) {
  motorRaw(IN1_L, IN2_L, s, INVERT_L);
}

// Pilote le moteur droit en tenant compte de INVERT_R.
void motorR(int s) {
  motorRaw(IN1_R, IN2_R, s, INVERT_R);
}

// Arrête immédiatement les deux moteurs.
// IMPORTANT : cette fonction est aussi appelée au début d'une mise à jour OTA
// et sur la commande STOP venant de la tablette. Il faut qu'elle fonctionne.
void stopMotors() {
  motorL(0);
  motorR(0);
}

// Active les deux moteurs pendant `ms` millisecondes, puis coupe tout.
// Ajoute une petite pause PAUSE_MS après l'arrêt (temps que le robot se stabilise).
void drive(int l, int r, unsigned long ms) {
  motorL(l);
  motorR(r);

  delay(ms);

  stopMotors();
  delay(PAUSE_MS);
}

// Avance d'UNE case tout droit (utilise SPEED_L, SPEED_R, CELL_MS).
void forwardCell() {
  drive(SPEED_L, SPEED_R, CELL_MS);
}

// Pivote de 90° sur place vers la droite.
// Astuce : un moteur avance, l'autre recule, durée = TURN90_MS.
void turnRight90() {
  drive(TURN_SPEED, -TURN_SPEED, TURN90_MS);
}

// Pivote de 90° sur place vers la gauche.
void turnLeft90() {
  drive(-TURN_SPEED, TURN_SPEED, TURN90_MS);
}

// =============================================================
//  À COMPLÉTER : direction absolue
// =============================================================

// Tourne pour faire face à la direction demandée (absolue, repère du plateau),
// puis avance d'UNE case. Met à jour la variable globale `heading`.
//   dir : 0=haut 1=droite 2=bas 3=gauche
//
// Astuce (le puzzle) :
//   diff = (dir - heading + 4) % 4
//     diff == 0 : déjà dans la bonne direction, rien à faire
//     diff == 1 : pivoter à droite 90°
//     diff == 2 : demi-tour (= 2 pivots à droite OU 2 à gauche)
//     diff == 3 : pivoter à gauche 90°
//   Ensuite : heading = dir, puis forwardCell().
void moveDir(int dir) {
  // TODO
}

// =============================================================
//  À COMPLÉTER : animations (bonus, libre à toi)
// =============================================================

// Clignote la LED n fois (ms allumée, ms éteinte).
// Déjà écrit, tu peux t'en servir dans tes animations.
void blink(int n, int ms) {
  for (int i = 0; i < n; i++) {
    digitalWrite(LED_PIN, HIGH); delay(ms);
    digitalWrite(LED_PIN, LOW);  delay(ms);
  }
}

// Animation de démarrage (quand la partie commence). Totalement libre : clignotements,
// dandinement, petits tours...
// Bonus : attendre (ROBOT_ID - 1) * 300 ms au tout début pour créer un effet "vague"
// entre les 6 robots quand ils s'animent tous ensemble.
void animStart() {
  // TODO (bonus)
}

// Animation de victoire (robot gagnant). Libre à toi : tours complets, LED à fond, etc.
void animWin() {
  // TODO (bonus)
}

// =============================================================
//  Réseau (fourni, ne pas modifier)
// =============================================================
void handlePacket(const uint8_t* data, int len) {
  if (len != sizeof(TrPacket)) return;
  TrPacket p;
  memcpy(&p, data, sizeof(p));
  if (p.magic != TR_MAGIC) return;
  if (p.cmd == TR_CMD_HEARTBEAT || p.cmd == TR_CMD_ACK) return;
  if (p.target != ROBOT_ID && p.target != TR_TARGET_ALL) return;

  sendAck(p.seq);

  if (p.seq == lastSeq) return;
  lastSeq = p.seq;

  if (p.cmd == TR_CMD_STOP) {
    xQueueReset(cmdQueue);
  }
  uint8_t c = p.cmd;
  xQueueSend(cmdQueue, &c, 0);
}

void onRecv(RecvSource src, const uint8_t* data, int len) { handlePacket(data, len); }

// =============================================================
//  Setup / loop (fourni)
// =============================================================
void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(L_IN1, OUTPUT); pinMode(L_IN2, OUTPUT);
  pinMode(R_IN1, OUTPUT); pinMode(R_IN2, OUTPUT);
  stopMotors();

  cmdQueue = xQueueCreate(16, sizeof(uint8_t));

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(MASTER_SSID, MASTER_PASS);
  Serial.printf("WiFi: association a %s", MASTER_SSID);
  uint32_t wifiDeadline = millis() + 5000;
  while (WiFi.status() != WL_CONNECTED && millis() < wifiDeadline) {
    delay(200);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("WiFi OK, IP %s, canal %d\n",
                  WiFi.localIP().toString().c_str(), WiFi.channel());
  } else {
    Serial.println("WiFi echec : canal force pour ESP-NOW");
    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(TR_WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
  }

  if (esp_now_init() != ESP_OK) {
    Serial.println("ERREUR esp_now_init, redemarrage");
    delay(1000);
    ESP.restart();
  }
  esp_now_register_recv_cb(onRecv);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = TR_WIFI_CHANNEL;
  peer.ifidx   = WIFI_IF_STA;
  peer.encrypt = false;
  esp_now_add_peer(&peer);

  hbSeq = (uint8_t)esp_random();

  char hostname[24];
  snprintf(hostname, sizeof(hostname), "trivial-robot-%d", ROBOT_ID);
  ArduinoOTA.setHostname(hostname);
  ArduinoOTA.setPassword(OTA_PASS);
  ArduinoOTA.onStart([]() { stopMotors(); Serial.println("[OTA] debut"); });
  ArduinoOTA.onEnd([]()  { Serial.println("[OTA] fin"); });
  ArduinoOTA.onError([](ota_error_t err) { Serial.printf("[OTA] erreur %u\n", err); });
  ArduinoOTA.begin();

  Serial.printf("Robot %d pret, MAC %s, canal %d, hostname %s\n", ROBOT_ID,
                WiFi.macAddress().c_str(), TR_WIFI_CHANNEL, hostname);
  blink(ROBOT_ID, 150);
  sendHeartbeat();
}

void loop() {
  uint8_t cmd;
  if (xQueueReceive(cmdQueue, &cmd, pdMS_TO_TICKS(50)) == pdTRUE) {
    Serial.printf("cmd %u\n", cmd);
    switch (cmd) {
      case TR_CMD_UP:    moveDir(0); break;
      case TR_CMD_RIGHT: moveDir(1); break;
      case TR_CMD_DOWN:  moveDir(2); break;
      case TR_CMD_LEFT:  moveDir(3); break;
      case TR_CMD_ANIM:  animStart(); break;
      case TR_CMD_WIN:   animWin(); break;
      case TR_CMD_STOP:  stopMotors(); break;
    }
  }
  ArduinoOTA.handle();
  if (millis() - lastHeartbeat >= TR_HEARTBEAT_MS) sendHeartbeat();
}
