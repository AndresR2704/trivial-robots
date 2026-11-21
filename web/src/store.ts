// Persistance locale (localStorage), tolérante aux erreurs.
// La clé est inchangée depuis la v1 : une partie sauvegardée sur une tablette
// avec l'ancienne version reste reprenable.
import type { GameState, TeamInput } from "./game/game.ts";

const STORE_KEY = "trivial-robots-v1";

export interface Store {
  /** Adresse WebSocket du maître. */
  url?: string;
  /** Partie en cours (null après abandon ou fin de partie). */
  game?: GameState | null;
  /** Équipes saisies sur l'écran de configuration. */
  setupTeams?: TeamInput[];
}

export function loadStore(): Store {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) as string) || {};
  } catch {
    return {};
  }
}

export function saveStore(data: Store): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    // stockage indisponible (mode privé, quota) : la partie continue sans sauvegarde
  }
}
