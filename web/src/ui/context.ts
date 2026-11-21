// Contexte partagé par les écrans : état du jeu, liaison, stockage, navigation.
import type { Game } from "../game/game.ts";
import type { MasterLink } from "../link/master-link.ts";
import type { Store } from "../store.ts";

export type View = "setup" | "game" | "manual";

export interface Screen {
  render(): void;
}

export interface AppContext {
  readonly game: Game;
  readonly link: MasterLink;
  readonly store: Store;
  /** Enregistre le stockage tel quel. */
  save(): void;
  /** Enregistre l'état de la partie en cours. */
  persist(): void;
  /** Affiche un écran et le redessine. */
  go(view: View): void;
  /** Quitte le mode manuel vers l'écran précédent. */
  back(): void;
}
