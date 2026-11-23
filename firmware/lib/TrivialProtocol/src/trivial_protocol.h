// trivial_protocol.h : protocole ESP-NOW commun au maître et aux robots.
// Source UNIQUE, partagée par firmware/maitre et firmware/robot (bibliothèque TrivialProtocol).
#pragma once
#include <stdint.h>

#define TR_WIFI_CHANNEL 1      // canal WiFi commun (point d'accès + ESP-NOW)
#define TR_MAGIC        0xA7   // octet d'identification des paquets
#define TR_TARGET_ALL   0xFF   // cible "tous les robots"
#define TR_REPEAT       3      // chaque paquet est émis 3 fois (broadcast sans ACK)
#define TR_ROBOT_COUNT  6      // nombre de robots sur le plateau
#define TR_HEARTBEAT_MS 1000   // période d'émission du heartbeat (robot -> maître)
#define TR_ONLINE_MS    3000   // au-delà de ce silence, un robot est considéré hors-ligne
#define TR_ACK_TIMEOUT_MS 180  // sans ACK dans ce délai, le maître retransmet
#define TR_ACK_MAX_TRIES  4    // nombre total d'émissions avant abandon (NACK)

enum TrCmd : uint8_t {
  TR_CMD_UP    = 1,  // une case vers le haut du plateau
  TR_CMD_DOWN  = 2,  // une case vers le bas
  TR_CMD_LEFT  = 3,  // une case vers la gauche
  TR_CMD_RIGHT = 4,  // une case vers la droite
  TR_CMD_ANIM  = 5,  // animation de départ
  TR_CMD_STOP  = 6,  // arrêt immédiat + vidage de la file
  TR_CMD_WIN   = 7,  // animation de victoire
  TR_CMD_HEARTBEAT = 8, // robot -> maître : "je suis là". Dans ce cas target = ID source.
  TR_CMD_ACK   = 9,  // robot -> maître : accuse réception d'une commande (target = ID source, seq = échoé).
};

typedef struct __attribute__((packed)) {
  uint8_t magic;   // TR_MAGIC
  uint8_t target;  // 1..6 ou TR_TARGET_ALL (destination) ; ID source pour TR_CMD_HEARTBEAT / TR_CMD_ACK
  uint8_t cmd;     // TrCmd
  uint8_t seq;     // numéro de séquence (dédoublonnage des répétitions, corrélation des ACK)
} TrPacket;
