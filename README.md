# Trivial Robots

Trivial Pursuit joué avec 6 robots ESP32, pilotés depuis une tablette Android.

```
Tablette (APK)  --WiFi / WebSocket-->  ESP32 maître  --ESP-NOW broadcast-->  6 robots ESP32
                ws://192.168.4.1:81     (point d'accès "TrivialRobots")
```

## Contenu

| Dossier | Rôle |
|---|---|
| `web/` | Interface tablette en **TypeScript** (logique de jeu, liaison maître, écrans), compilée par esbuild |
| `android-app/` | Coquille Android : WebView plein écran qui embarque l'interface compilée (`web/dist/www`) |
| `firmware/lib/TrivialProtocol/` | Protocole ESP-NOW commun au maître et aux robots (**source unique**) |
| `firmware/maitre/` | ESP32 maître : point d'accès WiFi, serveur WebSocket, relais ESP-NOW |
| `firmware/robot/` | ESP32 robot : réception ESP-NOW, déplacement case par case, animations |
| `.github/workflows/build.yml` | CI : tests, APK debug/release, compilation des firmwares |

### Organisation de `web/src`

| Dossier | Contenu |
|---|---|
| `game/` | Règles du Trivial Pursuit (aucun accès au DOM ni au réseau, testées) + banque de questions |
| `link/` | Liaison WebSocket avec le maître (reconnexion, keepalive) et format des commandes |
| `ui/` | Écrans (configuration, partie, mode manuel) et composants d'affichage |
| `store.ts` | Sauvegarde locale (reprise de partie) |
| `main.ts` | Point d'entrée : assemble jeu, liaison et écrans |

## 1. Firmware

Carte **ESP32 Dev Module**. Deux façons de compiler :

### Option A : PlatformIO (recommandé)
Installer PlatformIO (extension VS Code ou `pip install platformio`), puis :
```sh
cd firmware/maitre && pio run -t upload            # maître (USB)
cd firmware/robot  && pio run -e robot3 -t upload  # robot n°3 (robot1 … robot6)
pio device monitor                                 # moniteur série 115200
```
Bibliothèques et protocole commun sont gérés automatiquement. Chaque environnement `robotN` fixe `ROBOT_ID = N` : plus besoin de modifier le code pour chaque robot.

### OTA (mise à jour par WiFi)
Une fois chaque ESP32 flashé au moins une fois par USB, les suivantes passent par WiFi :
```sh
cd firmware/maitre && pio run -e maitre-ota -t upload   # maître
cd firmware/robot  && pio run -e robot3-ota -t upload   # robot n°3
```
Pré-requis :
- Le maître doit être en route (il expose le WiFi `TrivialRobots`), et le PC connecté dessus.
- Les robots doivent être allumés : au boot ils s'associent au point d'accès du maître pour être joignables.
- Mot de passe OTA : `trivial-ota-2026` (modifiable dans `maitre.ino` et `robot.ino` — doit rester identique partout).
- Hostnames : `trivial-master.local`, `trivial-robot-1.local` … `trivial-robot-6.local`. Si mDNS ne fonctionne pas (Windows sans Bonjour), remplacer `upload_port` dans `platformio.ini` par l'IP affichée dans les logs du maître.

### Option B : IDE Arduino
1. Copier le dossier `firmware/lib/TrivialProtocol` dans `Documents/Arduino/libraries/` (à refaire si le protocole change).
2. Installer la bibliothèque **WebSockets** de Markus Sattler (pour le maître).
3. Ouvrir `firmware/maitre/maitre.ino` ou `firmware/robot/robot.ino`. Pour un robot, changer `ROBOT_ID` en haut du fichier.

### Réglages
- **Maître** : WiFi par défaut `TrivialRobots` / `trivial2026` (haut de `maitre.ino`). Test sans tablette : moniteur série 115200, taper `MOVE 1 UP`, `ANIM`, `STOP`.
- **Robots** :
  1. Au démarrage, la LED clignote ID fois.
  2. Adapter les broches moteurs (driver 2 entrées PWM : DRV8833, L9110S, L298N).
  3. Calibrer sur le plateau : `CELL_MS` (1 case), `TURN90_MS` (pivot 90°), `SPEED_L/R` (aller droit), `INVERT_L/R`.
  4. **Poser chaque robot face au "haut" du plateau** avant de démarrer : le robot mémorise son orientation et pivote tout seul vers la direction demandée.

## 2. APK

### Option A : GitHub Actions (rien à installer)
1. Pousser ce dépôt sur GitHub.
2. Onglet **Actions** > dernier run "Build" > télécharger l'artefact `TrivialRobots-debug-apk`.
3. Installer `app-debug.apk` sur la tablette (autoriser les sources inconnues).

La CI compile aussi les firmwares (artefact `TrivialRobots-firmwares`) et, si une clé est configurée, un APK release signé.

### Option B : en local
Prérequis : **Node.js 22.18+** et **Android Studio** (fournit le JDK 17 et le SDK Android).
- Android Studio : ouvrir `android-app/`, laisser Gradle synchroniser, puis *Build > Build APK(s)*.
- Ou en ligne de commande, depuis `android-app/` : `./gradlew assembleDebug` (Windows : `gradlew.bat assembleDebug`).

Gradle compile l'interface web automatiquement avant chaque APK (`npm ci` puis `npm run build` dans `web/`).
APK produit : `android-app/app/build/outputs/apk/debug/app-debug.apk`.

### APK release signé
1. Créer une clé **une seule fois** et la conserver précieusement (sans elle, impossible de mettre à jour l'app installée) :
   ```sh
   keytool -genkeypair -keystore trivial-release.jks -alias trivial -keyalg RSA -keysize 2048 -validity 10000
   ```
2. **En local** : créer `android-app/keystore.properties` (ignoré par git) :
   ```properties
   storeFile=../trivial-release.jks
   storePassword=...
   keyAlias=trivial
   keyPassword=...
   ```
   puis `./gradlew assembleRelease` → `app/build/outputs/apk/release/app-release.apk`.
3. **Sur GitHub** : *Settings > Secrets and variables > Actions*, créer `TR_KEYSTORE_BASE64` (contenu de `base64 -w0 trivial-release.jks`), `TR_KEYSTORE_PASSWORD`, `TR_KEY_ALIAS`, `TR_KEY_PASSWORD`.

Le numéro de version suit le numéro du run GitHub Actions (`1.0.<run>`).

### Développer l'interface sans tablette
Depuis `web/` :
```sh
npm install
npm run dev        # http://localhost:8000, recompilé à chaque modification
npm test           # tests des règles du jeu
npm run typecheck  # vérification des types
```
Pour piloter de vrais robots depuis le PC, connecter le PC au WiFi `TrivialRobots`.

## 3. Déroulement d'une partie
1. Tablette connectée au WiFi `TrivialRobots` (Android peut signaler "pas d'Internet" : rester connecté).
2. Créer les équipes (une par robot), puis **Lancer l'animation et démarrer**.
3. Pour chaque tour : lancer le dé, déplacer le robot case par case avec les flèches (annulation possible), indiquer la catégorie de la case d'arrivée (et si c'est une case camembert), afficher la question, valider bonne ou mauvaise réponse.
4. Bonne réponse : l'équipe rejoue. Mauvaise : équipe suivante.
5. Avec les 6 camemberts : bouton **Au centre : question finale**, catégorie choisie par les adversaires. Bonne réponse : victoire et animation du robot gagnant.

Le **mode manuel** permet de placer ou tester n'importe quel robot (ou tous). La partie est sauvegardée automatiquement et peut être reprise.

## Questions
Dans `web/src/game/questions.ts` (72 questions, 12 par catégorie). Format :
```ts
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

Réponses immédiates du maître : `OK`, `PONG`, `ERR ...`.

Messages asynchrones poussés par le maître :
| Message | Effet |
|---|---|
| `STATUS a,b,c,d,e,f` | état en ligne/hors-ligne de chaque robot (1 par seconde, et à chaque nouvelle connexion WebSocket) |
| `NACK <id> <cmd>` | une commande ciblée (hors `ALL`) n'a pas reçu d'ACK après `TR_ACK_MAX_TRIES` tentatives ; `cmd` est l'opcode de `TrCmd` (1..7) |

Maître -> robots : paquet ESP-NOW de 4 octets `{magic, target, cmd, seq}` émis 3 fois, dédoublonné par `seq` côté robot (format défini dans `firmware/lib/TrivialProtocol/src/trivial_protocol.h`). Le robot répond par un paquet `TR_CMD_ACK` (avec `seq` échoé) pour chaque commande reçue ; sans ACK, le maître retransmet jusqu'à 4 fois puis abandonne et envoie `NACK` sur WebSocket. Les robots envoient aussi un heartbeat chaque seconde (`TR_CMD_HEARTBEAT`) pour que le maître publie `STATUS`.
