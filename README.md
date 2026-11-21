# Trivial Robots

Trivial Pursuit joué avec 6 robots ESP32, pilotés depuis une tablette Android.

```
Tablette (APK)  --WiFi / WebSocket-->  ESP32 maître  --ESP-NOW broadcast-->  6 robots ESP32
                ws://192.168.4.1:81     (point d'accès "TrivialRobots")
```

## Contenu

| Dossier | Rôle |
|---|---|
| `android-app/` | Projet Android (WebView plein écran + jeu en HTML/JS dans `assets/www`) |
| `firmware/maitre/` | ESP32 maître : point d'accès WiFi, serveur WebSocket, relais ESP-NOW |
| `firmware/robot/` | ESP32 robot : réception ESP-NOW, déplacement case par case, animations |
| `.github/workflows/build-apk.yml` | Compile l'APK automatiquement sur GitHub |

## 1. Firmware

**Arduino IDE**, carte "ESP32 Dev Module" (cœur Arduino-ESP32 2.x ou 3.x).

### Maître (`firmware/maitre/maitre.ino`)
- Bibliothèque à installer : **WebSockets** de Markus Sattler.
- WiFi par défaut : `TrivialRobots` / `trivial2026` (modifiable en haut du fichier).
- Test sans tablette : moniteur série 115200, tape `MOVE 1 UP`, `ANIM`, `STOP`.

### Robots (`firmware/robot/robot.ino`)
1. Changer `ROBOT_ID` (1 à 6) pour **chaque** robot. Au démarrage la LED clignote ID fois.
2. Adapter les broches moteurs (driver 2 entrées PWM : DRV8833, L9110S, L298N).
3. Calibrer sur le plateau : `CELL_MS` (1 case), `TURN90_MS` (pivot 90°), `SPEED_L/R` (aller droit), `INVERT_L/R`.
4. **Poser chaque robot face au "haut" du plateau** avant de démarrer : le robot mémorise son orientation et pivote tout seul vers la direction demandée.

`protocol.h` doit rester identique dans les deux dossiers.

## 2. APK

### Option A : GitHub Actions (rien à installer)
1. Pousser ce dossier sur un repo GitHub.
2. Onglet **Actions** > dernier run "Build APK" > télécharger l'artefact `TrivialRobots-apk`.
3. Installer `app-debug.apk` sur la tablette (autoriser les sources inconnues).

### Option B : Android Studio
Ouvrir `android-app/`, laisser Gradle synchroniser, puis *Build > Build APK(s)*.

### Tester l'interface sans tablette
Ouvrir `android-app/app/src/main/assets/www/index.html` dans Chrome sur un PC connecté au WiFi du maître.

## 3. Déroulement d'une partie
1. Tablette connectée au WiFi `TrivialRobots` (Android peut signaler "pas d'Internet" : rester connecté).
2. Créer les équipes (une par robot), puis **Lancer l'animation et démarrer**.
3. Pour chaque tour : lancer le dé, déplacer le robot case par case avec les flèches (annulation possible), indiquer la catégorie de la case d'arrivée (et si c'est une case camembert), afficher la question, valider bonne ou mauvaise réponse.
4. Bonne réponse : l'équipe rejoue. Mauvaise : équipe suivante.
5. Avec les 6 camemberts : bouton **Au centre : question finale**, catégorie choisie par les adversaires. Bonne réponse : victoire et animation du robot gagnant.

Le **mode manuel** permet de placer ou tester n'importe quel robot (ou tous). La partie est sauvegardée automatiquement et peut être reprise.

## Questions
Dans `android-app/app/src/main/assets/www/questions.js` (72 questions, 12 par catégorie). Format :
```js
{ c: 0, q: "Question ?", a: "Réponse" }   // c = 0 Géo, 1 Divertissement, 2 Histoire, 3 Arts, 4 Sciences, 5 Sports
```
Pas de répétition tant qu'une catégorie n'est pas épuisée.

## Protocole tablette -> maître (texte WebSocket)
| Commande | Effet |
|---|---|
| `MOVE <1-6\|ALL> <UP\|DOWN\|LEFT\|RIGHT>` | 1 case dans la direction (absolue, vue plateau) |
| `ANIM [id\|ALL]` | animation de départ (vague décalée selon l'ID) |
| `WIN <id>` | animation de victoire |
| `STOP [id\|ALL]` | arrêt + vidage de la file de commandes |
| `PING` | répond `PONG` (keepalive) |

Réponses du maître : `OK`, `PONG`, `ERR ...`.
Maître -> robots : paquet ESP-NOW de 4 octets `{magic, target, cmd, seq}` émis 3 fois, dédoublonné par `seq` côté robot.
