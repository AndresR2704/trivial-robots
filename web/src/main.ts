// Point d'entrée : assemble la logique de jeu, la liaison avec le maître et les écrans.
import { Game } from "./game/game.ts";
import { QUESTIONS } from "./game/questions.ts";
import { MasterLink, ROBOT_COUNT } from "./link/master-link.ts";
import { loadStore, saveStore } from "./store.ts";
import type { AppContext, Screen, View } from "./ui/context.ts";
import { $, toast } from "./ui/dom.ts";
import { createGameScreen } from "./ui/game-screen.ts";
import { createManualScreen } from "./ui/manual-screen.ts";
import { createSetupScreen } from "./ui/setup-screen.ts";
import { robotColor } from "./ui/widgets.ts";

declare global {
  interface Window {
    /** Appelé par MainActivity sur le bouton retour Android ; true = géré. */
    onAndroidBack?: () => boolean;
  }
}

const DEFAULT_MASTER_URL = "ws://192.168.4.1:81";
const VIEWS: readonly View[] = ["setup", "game", "manual"];

const store = loadStore();

// Construit une fois pour toutes le bandeau d'état des robots (barre du haut).
function initRobotStatus(): void {
  const strip = $("robot-status");
  strip.innerHTML = "";
  for (let i = 1; i <= ROBOT_COUNT; i++) {
    const s = document.createElement("span");
    s.className = "r";
    s.dataset.robot = String(i);
    s.dataset.offline = "1";   // par défaut hors-ligne jusqu'à réception d'un STATUS
    s.textContent = String(i);
    s.style.setProperty("--robot", robotColor(i));
    strip.appendChild(s);
  }
}

// Synchronise tous les éléments [data-robot="N"] du DOM avec l'état en ligne.
function syncRobots(online: readonly boolean[]): void {
  for (let i = 1; i <= ROBOT_COUNT; i++) {
    const on = online[i - 1] === true;
    document.querySelectorAll<HTMLElement>(`[data-robot="${i}"]`).forEach(el => {
      if (on) delete el.dataset.offline;
      else el.dataset.offline = "1";
    });
  }
}

initRobotStatus();

const link = new MasterLink(store.url || DEFAULT_MASTER_URL, {
  onState(state, label) {
    const c = $("conn");
    c.className = "pill " + state;
    c.textContent = label;
  },
  onRobots: syncRobots,
  notify: toast,
});

let view: View = "setup";
let prevView: View = "setup"; // dernier écran hors mode manuel

function show(name: View): void {
  if (name !== "manual") prevView = name;
  view = name;
  VIEWS.forEach(n => $("screen-" + n).classList.toggle("hidden", n !== name));
  const inGame = name === "game";
  $("btn-skip").classList.toggle("hidden", !inGame);
  $("btn-new").classList.toggle("hidden", !inGame);
  $("btn-manual").classList.toggle("hidden", name === "manual");
}

const ctx: AppContext = {
  game: new Game(QUESTIONS),
  link,
  store,
  save: () => saveStore(store),
  persist() {
    store.game = ctx.game.state;
    saveStore(store);
  },
  go(name) {
    show(name);
    screens[name].render();
    syncRobots(link.online);   // réapplique l'état hors-ligne aux éléments fraîchement rendus
  },
  back() {
    ctx.go(prevView);
  },
};

const screens: Record<View, Screen> = {
  setup: createSetupScreen(ctx),
  game: createGameScreen(ctx),
  manual: createManualScreen(ctx),
};

$("btn-manual").onclick = () => ctx.go("manual");

window.onAndroidBack = () => {
  if (view === "manual") { ctx.back(); return true; }
  if (view === "game") { toast("Utilise « Nouvelle partie » pour quitter la partie"); return true; }
  return false;
};

ctx.go("setup");
link.start();
