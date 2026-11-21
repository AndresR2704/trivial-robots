// Commandes texte tablette -> ESP32 maître (voir README, « Protocole »).
import type { Dir } from "../game/game.ts";

/** Numéro de robot (1..6) ou tous les robots. */
export type Target = number | "ALL";

export const cmd = {
  /** Une case dans la direction (absolue, vue plateau). */
  move: (target: Target, dir: Dir): string => `MOVE ${target} ${dir}`,
  /** Animation de départ. */
  anim: (target: Target): string => `ANIM ${target}`,
  /** Animation de victoire. */
  win: (target: Target): string => `WIN ${target}`,
  /** Arrêt + vidage de la file de commandes. */
  stop: (target: Target): string => `STOP ${target}`,
  /** Keepalive : le maître répond PONG. */
  ping: (): string => "PING",
};
