<div align="center">

# Squelette Robot ESP32 : Guide Étudiant (Micro C / Arduino)

![Langage](https://img.shields.io/badge/Langage-C%2FC%2B%2B%20(Arduino%20ESP32)-00599C?style=flat-square&logo=cplusplus&logoColor=white)
![ESTIA](https://img.shields.io/badge/ESTIA-3A%20Projet%20Trivial%20Robots-1D4ED8?style=flat-square)
![Statut](https://img.shields.io/badge/Mode-Squelette%20%C3%A0%20compl%C3%A9ter-F59E0B?style=flat-square)

*Toute la partie réseau complexe (WiFi, ESP-NOW, OTA, heartbeat, ACK) est **déjà prête**. Ton objectif : coder uniquement les fonctions de pilotage des moteurs et de déplacement.*

[Retour au README principal](../../README.md) · [Guide Firmware & OTA](../README.md) · [Protocole TrivialProtocol](../lib/TrivialProtocol/README.md)

</div>

---

## Objectif de ce squelette

Ce dossier contient le firmware **de base** des 6 robots du plateau dans [`robot/robot.ino`](robot/robot.ino).

Si tu flashes ce code tel quel (sans rien modifier) :
- **[OK]** Le robot démarre et fait clignoter sa LED bleue `ROBOT_ID` fois.
- **[OK]** Il se connecte au WiFi du maître (`TrivialRobots`) et active la mise à jour sans fil (**OTA**).
- **[OK]** Il envoie son signal de présence (*heartbeat*) chaque seconde : il apparaît **en ligne** sur la tablette.
- **[OK]** Il reçoit les commandes de la tablette via ESP-NOW, renvoie un accusé de réception (`ACK`) et les affiche sur le moniteur série (`cmd 1`, `cmd 2`, etc.).
- **[À FAIRE]** **Il ne bouge pas encore**, car les fonctions moteurs sont vides (`// TODO`). **À toi de jouer !**

> [!IMPORTANT]
> **Règle d'or :** Ne modifie **pas** les sections marquées `Réseau (fourni, ne pas modifier)` ni `Setup / loop (fourni)`. Travaille uniquement dans les zones marquées **`À COMPLÉTER`** (lignes 95 à 205 de `robot/robot.ino`) et les constantes de câblage/calibration (lignes 46 à 61).

---

## 1. Câblage matériel prévu

Le squelette est prévu pour un robot à **2 roues motrices indépendantes** (propulsion différentielle) pilotées par un **driver moteur à 2 entrées PWM par moteur** :
- **DRV8833** (recommandé)
- **L9110S**
- **L298N** *(avec les cavaliers `ENA` et `ENB` pontés sur 5 V)*

| Signal | Broche ESP32 par défaut | Rôle |
|---|---|---|
| `L_IN1` | `GPIO 25` | Moteur **gauche**, entrée 1 (PWM) |
| `L_IN2` | `GPIO 26` | Moteur **gauche**, entrée 2 (PWM) |
| `R_IN1` | `GPIO 27` | Moteur **droit**, entrée 1 (PWM) |
| `R_IN2` | `GPIO 14` | Moteur **droit**, entrée 2 (PWM) |
| `LED_PIN` | `GPIO 2` | LED intégrée sur l'ESP32 |

> [!NOTE]
> Si ton câblage physique utilise d'autres broches, modifie simplement les constantes `L_IN1`, `L_IN2`, `R_IN1`, `R_IN2` en haut de [`robot/robot.ino`](robot/robot.ino).

---

## 2. Les 7 étapes à coder dans l'ordre

Il est fortement conseillé d'implémenter les fonctions **dans cet ordre précis** et de tester régulièrement :

### Étape 1 : `motorRaw(int in1, int in2, int speed, bool invert)`
Fait tourner **un seul moteur** à une vitesse signée comprise entre `-255` (arrière à fond) et `+255` (avant à fond), `0` = arrêt.

- **Comment fonctionne le PWM (`analogWrite`) ?**
  - `analogWrite(broche, valeur)` envoie une tension moyenne proportionnelle à `valeur` (`0` = 0 %, `255` = 100 %).
  - Pour tourner en **avant** (`speed >= 0`) : PWM sur `in1`, `0` sur `in2`.
  - Pour tourner en **arrière** (`speed < 0`) : `0` sur `in1`, PWM (`-speed`) sur `in2`.
- **À ne pas oublier :**
  1. Si `invert` vaut `true`, inverse le signe de `speed` (`speed = -speed;`).
  2. Borne `speed` entre `-255` et `255` avec `constrain(speed, -255, 255);`.

### Étape 2 : `motorL(int s)` et `motorR(int s)`
Deux fonctions raccourcis d'une seule ligne qui appellent `motorRaw(...)` :
- `motorL(s)` utilise `L_IN1`, `L_IN2` et `INVERT_L`.
- `motorR(s)` utilise `R_IN1`, `R_IN2` et `INVERT_R`.

### Étape 3 : `stopMotors()`
Coupe immédiatement les deux moteurs (`motorL(0)` et `motorR(0)`).

> [!WARNING]
> `stopMotors()` est appelée automatiquement au démarrage d'une mise à jour **OTA** et lorsque la tablette envoie **`STOP`**. Vérifie qu'elle arrête bien les deux roues immédiatement.

### Étape 4 : `drive(int l, int r, unsigned long ms)`
Active les deux moteurs aux vitesses `l` (gauche) et `r` (droit) pendant `ms` millisecondes, puis arrête les moteurs et attend une courte stabilisation (`PAUSE_MS`).

```text
motorL(l) + motorR(r)  -->  delay(ms)  -->  stopMotors()  -->  delay(PAUSE_MS)
```

### Étape 5 : `forwardCell()`, `turnRight90()` et `turnLeft90()`
Les 3 mouvements élémentaires, chacun en **une ligne** grâce à `drive(...)` :
- **`forwardCell()`** : les deux roues avancent (`SPEED_L`, `SPEED_R`) pendant `CELL_MS`.
- **`turnRight90()`** : pivot sur place vers la droite → roue gauche en avant (`+TURN_SPEED`), roue droite en arrière (`-TURN_SPEED`) pendant `TURN90_MS`.
- **`turnLeft90()`** : pivot sur place vers la gauche → roue gauche en arrière (`-TURN_SPEED`), roue droite en avant (`+TURN_SPEED`) pendant `TURN90_MS`.

### Étape 6 : `moveDir(int dir)` *(la logique d'orientation absolue)*
La tablette n'envoie pas « avance » ou « tourne », elle envoie une **direction absolue sur le plateau** :

| Valeur de `dir` / `heading` | Direction sur le plateau |
| :---: | :--- |
| `0` | **Haut** (`TR_CMD_UP`) |
| `1` | **Droite** (`TR_CMD_RIGHT`) |
| `2` | **Bas** (`TR_CMD_DOWN`) |
| `3` | **Gauche** (`TR_CMD_LEFT`) |

Le robot garde en mémoire son orientation actuelle dans la variable globale `heading` (initialisée à `0` = face au haut du plateau).

Pour savoir de combien tourner afin de passer de `heading` à `dir`, on calcule :
```cpp
int diff = (dir - heading + 4) % 4;
```

| `diff` | Action à effectuer |
| :---: | :--- |
| `0` | Déjà dans la bonne direction → ne pas pivoter |
| `1` | 1 quart de tour vers la **droite** → `turnRight90()` |
| `2` | Demi-tour (180°) → `turnRight90()` deux fois *(ou `turnLeft90()` deux fois)* |
| `3` | 1 quart de tour vers la **gauche** → `turnLeft90()` |

Ensuite :
1. Mettre à jour l'orientation : `heading = dir;`
2. Avancer d'une case : `forwardCell();`

### Étape 7 : `animStart()` et `animWin()` *(bonus libre)*
Tu as carte blanche pour rendre les robots vivants :
- Tu disposes déjà de la fonction `blink(n, ms)` pour faire clignoter la LED.
- **`animStart()`** : jouée au lancement de la partie.
  - *Astuce « vague »* : ajouter `delay((ROBOT_ID - 1) * 300);` au début pour que les 6 robots s'animent les uns après les autres.
  - *Attention* : veille à ce que le robot retrouve son orientation de départ à la fin de l'animation (ex. un tour complet de 360° ou un aller-retour symétrique), sinon `heading` sera décalé.
- **`animWin()`** : jouée quand le robot gagne la partie (tours sur place, LED qui clignote vite, etc.).

---

## 3. Compiler et flasher ton robot

### Option A : PlatformIO *(recommandé)*

Depuis ce dossier `firmware/robot_squelette/` :

```bash
# 1er flash en USB (remplacer 1 par le numéro de ton robot : 1 à 6)
pio run -e robot1 -t upload

# Voir les messages de debug du robot (115200 bauds)
pio device monitor

# Mises à jour suivantes en WiFi (OTA), PC connecté au WiFi "TrivialRobots"
pio run -e robot1-ota -t upload
```

> [!TIP]
> Chaque environnement (`robot1` … `robot6`) injecte automatiquement `-DROBOT_ID=N` à la compilation. **Tu n'as jamais besoin de modifier `#define ROBOT_ID` dans le code.**

### Option B : IDE Arduino

1. Vérifie que `firmware/lib/TrivialProtocol` est bien copié dans `Documents/Arduino/libraries/`.
2. Ouvre [`robot/robot.ino`](robot/robot.ino).
3. Change la ligne `#define ROBOT_ID 2` avec le numéro de ton robot (`1` à `6`).
4. Choisis la carte **ESP32 Dev Module** et clique sur **Téléverser**.

---

## 4. Calibration sur le plateau

Chaque robot a de légères différences mécaniques (frottements, moteurs, tension batterie). Une fois tes fonctions codées, ajuste les constantes en haut de [`robot/robot.ino`](robot/robot.ino) en utilisant le **mode manuel** de la tablette (ou le moniteur série du maître) :

1. **Sens de rotation** : envoie `MOVE <ID> UP`.
   - Si une roue tourne en arrière au lieu d'avancer, passe `INVERT_L` ou `INVERT_R` à `true`.
2. **Trajectoire droite** :
   - Si le robot dévie vers la gauche, diminue légèrement `SPEED_R` (ou augmente `SPEED_L`).
   - S'il dévie vers la droite, fais l'inverse.
3. **Distance d'une case (`CELL_MS`)** :
   - Ajuste la durée en millisecondes (ex. `800`) jusqu'à ce qu'un `MOVE <ID> UP` corresponde exactement à **1 case** du plateau.
4. **Pivot exact à 90° (`TURN90_MS`)** :
   - Envoie `MOVE <ID> RIGHT` puis vérifie que le robot pivote pile de 90° (ni trop, ni pas assez). Ajuste `TURN90_MS` (ex. `420`) et/ou `TURN_SPEED`.
5. **Position de départ en partie** :
   - **Pose toujours chaque robot face au « haut » du plateau avant de l'allumer** (car `heading` démarre à `0`).

> [!NOTE]
> L'**OTA** permet en principe de modifier `CELL_MS` ou `TURN90_MS` et de reflasher ton robot sans câble USB. Attention toutefois : l'OTA n'est pas encore testée à 100 % et les essais doivent encore être poursuivis. En cas de problème, passe par le câble USB. Voir le [Guide Firmware & OTA](../README.md#6-procédure-de-mise-à-jour-ota).
