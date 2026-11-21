// Composants d'interface réutilisables (rendus en HTML).
import type { Dir } from "../game/game.ts";
import { CATEGORIES } from "../game/questions.ts";
import { $, esc } from "./dom.ts";

export const ROBOT_COLORS: readonly string[] = ["#ff6b6b", "#4dabf7", "#a9e34b", "#b197fc", "#ffd43b", "#63e6be"];

export function robotColor(robot: number): string {
  return ROBOT_COLORS[robot - 1];
}

/** Camembert des 6 catégories, parts gagnées en couleur. */
export function pieSVG(wedges: readonly boolean[]): string {
  const cx = 27, cy = 27, r = 24;
  let paths = "";
  for (let i = 0; i < 6; i++) {
    const a0 = (i * 60 - 90) * Math.PI / 180, a1 = ((i + 1) * 60 - 90) * Math.PI / 180;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const fill = wedges[i] ? CATEGORIES[i].color : "#2a3450";
    paths += `<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${fill}" stroke="#182032" stroke-width="2"/>`;
  }
  return `<svg class="pie" viewBox="0 0 54 54">${paths}<circle cx="${cx}" cy="${cy}" r="6" fill="#182032"/></svg>`;
}

/** Pavé directionnel ; prefix "g" = écran de jeu, "m" = mode manuel. */
export function padHTML(prefix: string): string {
  return `<div class="pad">
      <button class="up" data-dir="UP" id="${prefix}-UP">▲</button>
      <button class="left" data-dir="LEFT" id="${prefix}-LEFT">◀</button>
      <div class="center">${prefix === "g" ? "1 appui<br>= 1 case" : ""}</div>
      <button class="right" data-dir="RIGHT" id="${prefix}-RIGHT">▶</button>
      <button class="down" data-dir="DOWN" id="${prefix}-DOWN">▼</button>
    </div>`;
}

export function bindPad(prefix: string, handler: (dir: Dir) => void): void {
  (["UP", "DOWN", "LEFT", "RIGHT"] as const).forEach(d => {
    const b = $(`${prefix}-${d}`);
    if (b) b.onclick = () => handler(d);
  });
}

/** Boutons des 6 catégories ; attr = attribut data-* portant l'indice. */
export function catButtons(attr: string): string {
  return `<div class="cats">${CATEGORIES.map((c, i) =>
    `<button class="cat-btn" ${attr}="${i}" style="background:${c.color}">${esc(c.name)}</button>`).join("")}</div>`;
}
