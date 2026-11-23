// Liaison WebSocket avec l'ESP32 maître : connexion, reconnexion automatique,
// keepalive. Aucune dépendance à l'interface : l'état et les messages sont
// remontés par les callbacks de LinkEvents.
import { cmd } from "./commands.ts";

export type LinkState = "on" | "off" | "wait";

/** Nombre de robots (doit rester aligné avec TR_ROBOT_COUNT côté firmware). */
export const ROBOT_COUNT = 6;

export interface LinkEvents {
  /** Changement d'état de la connexion (pastille de la barre du haut). */
  onState(state: LinkState, label: string): void;
  /** État en ligne / hors ligne de chaque robot (index 0 = robot 1, …). */
  onRobots(online: readonly boolean[]): void;
  /** Message à afficher à l'opérateur (erreur maître, liaison absente). */
  notify(message: string): void;
}

const RETRY_MS = 2000;      // délai avant reconnexion
const PING_MS = 4000;       // période du keepalive
const RX_TIMEOUT_MS = 10000; // silence au-delà duquel la connexion est relancée

const ALL_OFFLINE: readonly boolean[] = Object.freeze(new Array(ROBOT_COUNT).fill(false));

export class MasterLink {
  url: string;
  open = false;
  online: readonly boolean[] = ALL_OFFLINE;
  private ws: WebSocket | null = null;
  private lastRx = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly events: LinkEvents;

  constructor(url: string, events: LinkEvents) {
    this.url = url;
    this.events = events;
  }

  /** Démarre le keepalive et la première connexion. */
  start(): void {
    // PING toutes les 4 s, reconnexion si rien reçu depuis 10 s
    setInterval(() => {
      if (this.open && this.ws) {
        try { this.ws.send(cmd.ping()); } catch { /* la fermeture relancera la connexion */ }
        if (Date.now() - this.lastRx > RX_TIMEOUT_MS) {
          try { this.ws.close(); } catch { /* déjà fermée */ }
        }
      }
    }, PING_MS);
    this.connect();
  }

  connect(): void {
    clearTimeout(this.timer);
    if (this.ws) {
      try { this.ws.onclose = null; this.ws.close(); } catch { /* déjà fermée */ }
    }
    this.events.onState("wait", "Connexion…");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.open = true;
      this.lastRx = Date.now();
      this.events.onState("on", "Maître connecté");
    };
    ws.onmessage = (ev) => {
      this.lastRx = Date.now();
      const m = String(ev.data);
      if (m.startsWith("STATUS ")) {
        const online = m.slice(7).split(",").map(x => x.trim() === "1");
        // Normalise à ROBOT_COUNT entrées (tolérant aux versions futures).
        while (online.length < ROBOT_COUNT) online.push(false);
        this.online = online.slice(0, ROBOT_COUNT);
        this.events.onRobots(this.online);
        return;
      }
      if (m.startsWith("ERR")) this.events.notify("Maître : " + m);
    };
    ws.onerror = () => { /* suivi d'un onclose */ };
    ws.onclose = () => {
      this.open = false;
      this.online = ALL_OFFLINE;
      this.events.onRobots(this.online);
      this.events.onState("off", "Maître déconnecté");
      this.retry();
    };
  }

  private retry(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.connect(), RETRY_MS);
  }

  /** Envoie une commande ; prévient l'opérateur et retourne false si la liaison est absente. */
  send(text: string): boolean {
    if (!this.open || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.notifyOffline();
      return false;
    }
    this.ws.send(text);
    return true;
  }

  /** true si la liaison est ouverte ; sinon prévient l'opérateur. */
  ensureOpen(): boolean {
    if (this.open) return true;
    this.notifyOffline();
    return false;
  }

  setUrl(url: string): void {
    this.url = url;
    this.connect();
  }

  private notifyOffline(): void {
    this.events.notify("Maître non connecté : vérifie le WiFi TrivialRobots");
  }
}
