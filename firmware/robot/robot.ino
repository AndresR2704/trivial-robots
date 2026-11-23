// ============================================================
//  Trivial Robots : ESP32 ROBOT
//  - Reçoit les commandes du maître en ESP-NOW (broadcast)
//  - 1 commande de direction = 1 case sur le plateau
//  - Robot à 2 roues motrices (différentiel) : il pivote vers la
//    direction demandée puis avance d'une case.
//
//  À RÉGLER pour chaque robot : ROBOT_ID, puis CELL_MS / TURN90_MS
//  et les vitesses après calibration sur le plateau.
//  Compatible cœur Arduino-ESP32 2.x et 3.x
// ============================================================
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_arduino_version.h>
#include <trivial_protocol.h>   // firmware/lib/TrivialProtocol

// 1er argument du callback de réception ESP-NOW selon la version du cœur.
// Type déclaré ici (avant toute fonction) pour que les prototypes générés
// automatiquement depuis le .ino (IDE Arduino, PlatformIO) le connaissent.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
typedef const esp_now_recv_info_t* RecvSource;  // cœur 3.x : infos de réception
#else
typedef const uint8_t* RecvSource;              // cœur 2.x : adresse MAC de l'émetteur
#endif

// ---------- Identité ----------
#ifndef ROBOT_ID            // PlatformIO : fourni par l'environnement (pio run -e robot3)
#define ROBOT_ID 1          // 1 à 6, UNIQUE par robot
#endif

// ---------- Câblage moteurs ----------
// Driver à 2 entrées PWM par moteur (DRV8833, L9110S, L298N avec ENA/ENB pontés).
// Pour un TB6612, adapter motorL()/motorR() (PWM + IN1/IN2 + STBY).
const int L_IN1 = 25, L_IN2 = 26;
const int R_IN1 = 27, R_IN2 = 14;
const int LED_PIN = 2;

// ---------- Calibration ----------
int SPEED_L   = 200;        // 0..255, ajuster pour aller droit
int SPEED_R   = 200;
int TURN_SPEED = 180;
unsigned long CELL_MS   = 800;   // durée pour avancer d'UNE case
unsigned long TURN90_MS = 420;   // durée pour pivoter de 90°
unsigned long PAUSE_MS  = 120;   // pause entre deux mouvements
bool INVERT_L = false;           // inverser si un moteur tourne à l'envers
bool INVERT_R = false;

// ---------- État ----------
// Orientation absolue par rapport au plateau : 0=haut 1=droite 2=bas 3=gauche
// Le robot doit être posé face au "haut" du plateau au démarrage.
int heading = 0;
QueueHandle_t cmdQueue;
volatile int lastSeq = -1;

// Heartbeat : annonce au maître que ce robot est en ligne.
const uint8_t BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};
uint8_t hbSeq = 0;
uint32_t lastHeartbeat = 0;

void sendHeartbeat() {
  TrPacket p;
  p.magic  = TR_MAGIC;
  p.target = ROBOT_ID;      // ID source (voir trivial_protocol.h)
  p.cmd    = TR_CMD_HEARTBEAT;
  p.seq    = ++hbSeq;
  esp_now_send(BROADCAST, (const uint8_t*)&p, sizeof(p));
  lastHeartbeat = millis();
}

// ---------- Moteurs ----------
void motorRaw(int in1, int in2, int speed, bool invert) {
  if (invert) speed = -speed;
  speed = constrain(speed, -255, 255);
  if (speed >= 0) { analogWrite(in1, speed); analogWrite(in2, 0); }
  else            { analogWrite(in1, 0);     analogWrite(in2, -speed); }
}
void motorL(int s) { motorRaw(L_IN1, L_IN2, s, INVERT_L); }
void motorR(int s) { motorRaw(R_IN1, R_IN2, s, INVERT_R); }
void stopMotors() { motorL(0); motorR(0); }

void drive(int l, int r, unsigned long ms) {
  motorL(l); motorR(r);
  delay(ms);
  stopMotors();
  delay(PAUSE_MS);
}
void forwardCell() { drive(SPEED_L, SPEED_R, CELL_MS); }
void turnRight90() { drive(TURN_SPEED, -TURN_SPEED, TURN90_MS); }
void turnLeft90()  { drive(-TURN_SPEED, TURN_SPEED, TURN90_MS); }

// Direction absolue demandée -> pivot éventuel puis 1 case
void moveDir(int dir) {
  int diff = (dir - heading + 4) % 4;
  if (diff == 1) turnRight90();
  else if (diff == 2) { turnRight90(); turnRight90(); }
  else if (diff == 3) turnLeft90();
  heading = dir;
  forwardCell();
}

// ---------- Animations ----------
void blink(int n, int ms) {
  for (int i = 0; i < n; i++) {
    digitalWrite(LED_PIN, HIGH); delay(ms);
    digitalWrite(LED_PIN, LOW);  delay(ms);
  }
}

// Animation de départ : effet "vague" (décalage selon l'ID),
// petit dandinement puis tour complet. L'orientation finale est inchangée.
void animStart() {
  delay((ROBOT_ID - 1) * 300);
  blink(3, 80);
  for (int i = 0; i < 3; i++) {
    drive(-TURN_SPEED, TURN_SPEED, TURN90_MS / 3);
    drive(TURN_SPEED, -TURN_SPEED, TURN90_MS / 3);
  }
  for (int i = 0; i < 4; i++) {
    motorL(TURN_SPEED); motorR(-TURN_SPEED);
    delay(TURN90_MS);
  }
  stopMotors();
  blink(2, 150);
}

// Animation de victoire : deux tours complets avec la LED allumée.
void animWin() {
  digitalWrite(LED_PIN, HIGH);
  for (int i = 0; i < 8; i++) {
    motorL(TURN_SPEED); motorR(-TURN_SPEED);
    delay(TURN90_MS);
  }
  stopMotors();
  blink(6, 100);
}

// ---------- Réception ESP-NOW ----------
void handlePacket(const uint8_t* data, int len) {
  if (len != sizeof(TrPacket)) return;
  TrPacket p;
  memcpy(&p, data, sizeof(p));
  if (p.magic != TR_MAGIC) return;
  if (p.target != ROBOT_ID && p.target != TR_TARGET_ALL) return;
  if (p.seq == lastSeq) return;      // répétition du même paquet
  lastSeq = p.seq;

  if (p.cmd == TR_CMD_STOP) {
    xQueueReset(cmdQueue);
  }
  uint8_t c = p.cmd;
  xQueueSend(cmdQueue, &c, 0);       // ne bloque jamais dans le callback
}

void onRecv(RecvSource src, const uint8_t* data, int len) { handlePacket(data, len); }

// ---------- Setup / loop ----------
void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(L_IN1, OUTPUT); pinMode(L_IN2, OUTPUT);
  pinMode(R_IN1, OUTPUT); pinMode(R_IN2, OUTPUT);
  stopMotors();

  cmdQueue = xQueueCreate(16, sizeof(uint8_t));

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  esp_wifi_set_promiscuous(true);
  esp_wifi_set_channel(TR_WIFI_CHANNEL, WIFI_SECOND_CHAN_NONE);
  esp_wifi_set_promiscuous(false);

  if (esp_now_init() != ESP_OK) {
    Serial.println("ERREUR esp_now_init, redemarrage");
    delay(1000);
    ESP.restart();
  }
  esp_now_register_recv_cb(onRecv);

  // Déclare le broadcast comme peer pour pouvoir émettre les heartbeats.
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, BROADCAST, 6);
  peer.channel = TR_WIFI_CHANNEL;
  peer.ifidx   = WIFI_IF_STA;
  peer.encrypt = false;
  esp_now_add_peer(&peer);

  hbSeq = (uint8_t)esp_random();

  Serial.printf("Robot %d pret, MAC %s, canal %d\n", ROBOT_ID,
                WiFi.macAddress().c_str(), TR_WIFI_CHANNEL);
  blink(ROBOT_ID, 150);   // la LED clignote ID fois au démarrage
  sendHeartbeat();        // annonce immédiatement sa présence
}

void loop() {
  uint8_t cmd;
  // Attente d'une commande avec un timeout court : on reprend la main
  // régulièrement pour émettre le heartbeat, même sans mouvement.
  if (xQueueReceive(cmdQueue, &cmd, pdMS_TO_TICKS(TR_HEARTBEAT_MS)) == pdTRUE) {
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
  if (millis() - lastHeartbeat >= TR_HEARTBEAT_MS) sendHeartbeat();
}
