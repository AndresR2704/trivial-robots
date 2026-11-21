// Logique de jeu Trivial Pursuit : aucune dépendance au DOM ni au réseau,
// testable sous Node (voir test/game.test.ts).

export type Dir = "UP" | "RIGHT" | "DOWN" | "LEFT";

export const DIRS: readonly Dir[] = ["UP", "RIGHT", "DOWN", "LEFT"];
export const OPPOSITE: Readonly<Record<Dir, Dir>> = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };
export const NB_CAT = 6;

export interface Category {
  name: string;
  color: string;
}

/** c = indice de catégorie (0..5), q = question, a = réponse. */
export interface Question {
  c: number;
  q: string;
  a: string;
}

export interface TeamInput {
  name: string;
  robot: number;
}

export interface Team extends TeamInput {
  wedges: boolean[];
}

export type Phase = "roll" | "move" | "land" | "final-cat" | "question" | "answer" | "won";
export type LastResult = "correct" | "wrong" | "wedge" | "relance" | "skip" | null;

/** État complet d'une partie : sérialisable en JSON (sauvegarde / reprise). */
export interface GameState {
  version: 1;
  teams: Team[];
  current: number;
  phase: Phase;
  dice: number | null;
  remaining: number;
  steps: Dir[];
  wedgeCase: boolean;
  category: number | null;
  questionIdx: number | null;
  isFinal: boolean;
  /** Questions déjà posées, par catégorie. */
  used: Record<number, number[]>;
  winner: number | null;
  lastResult: LastResult;
}

/** Commande robot produite par un déplacement. */
export interface RobotMove {
  robot: number;
  dir: Dir;
}

export interface AnswerResult {
  gotWedge: boolean;
  won: boolean;
}

/** Tire un entier dans [0, n). */
export type Rng = (n: number) => number;

function defaultRng(n: number): number {
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    const a = new Uint32Array(1);
    c.getRandomValues(a);
    return a[0] % n;
  }
  return Math.floor(Math.random() * n);
}

export class Game {
  readonly questions: readonly Question[];
  readonly rng: Rng;
  state: GameState | null = null;

  constructor(questions: readonly Question[], rng?: Rng) {
    this.questions = questions;
    this.rng = rng || defaultRng;
  }

  /** État courant ; lève une erreur si aucune partie n'est chargée. */
  private get s(): GameState {
    if (!this.state) throw new Error("Aucune partie en cours");
    return this.state;
  }

  newGame(teams: readonly TeamInput[]): GameState {
    if (!teams || teams.length < 1 || teams.length > 6) throw new Error("1 à 6 équipes");
    const robots = new Set(teams.map(t => t.robot));
    if (robots.size !== teams.length) throw new Error("Chaque équipe doit avoir un robot différent");
    this.state = {
      version: 1,
      teams: teams.map(t => ({ name: t.name, robot: t.robot, wedges: Array<boolean>(NB_CAT).fill(false) })),
      current: 0,
      phase: "roll",
      dice: null,
      remaining: 0,
      steps: [],
      wedgeCase: false,
      category: null,
      questionIdx: null,
      isFinal: false,
      used: {},
      winner: null,
      lastResult: null,
    };
    return this.state;
  }

  load(state: GameState): GameState {
    this.state = state;
    return state;
  }

  get team(): Team {
    return this.s.teams[this.s.current];
  }

  private need(phase: Phase | readonly Phase[]): void {
    const cur = this.s.phase;
    const ok = typeof phase === "string" ? cur === phase : phase.includes(cur);
    if (!ok) throw new Error("Action impossible en phase " + cur);
  }

  canFinal(): boolean {
    return this.s.phase === "roll" && this.team.wedges.every(Boolean);
  }

  roll(): number {
    this.need("roll");
    const s = this.s;
    const dice = this.rng(6) + 1;
    s.dice = dice;
    s.remaining = dice;
    s.steps = [];
    s.lastResult = null;
    s.phase = "move";
    return dice;
  }

  /** Avance d'une case ; retourne la commande à envoyer au robot. */
  step(dir: Dir): RobotMove {
    this.need("move");
    if (!DIRS.includes(dir)) throw new Error("Direction inconnue");
    const s = this.s;
    if (s.remaining <= 0) throw new Error("Plus de cases");
    s.remaining--;
    s.steps.push(dir);
    if (s.remaining === 0) s.phase = "land";
    return { robot: this.team.robot, dir };
  }

  /** Annule le dernier pas ; retourne la commande inverse, ou null s'il n'y a rien à annuler. */
  undoStep(): RobotMove | null {
    this.need(["move", "land"]);
    const s = this.s;
    const dir = s.steps.pop();
    if (dir === undefined) return null;
    s.remaining++;
    s.phase = "move";
    return { robot: this.team.robot, dir: OPPOSITE[dir] };
  }

  endMove(): void {
    this.need("move");
    this.s.phase = "land";
  }

  relance(): void {
    this.need("land");
    this.s.phase = "roll";
    this.s.lastResult = "relance";
  }

  /** Tire une question de la catégorie, sans répétition tant que la catégorie n'est pas épuisée. */
  private draw(cat: number): number {
    const s = this.s;
    const pool: number[] = [];
    this.questions.forEach((q, i) => { if (q.c === cat) pool.push(i); });
    if (pool.length === 0) throw new Error("Aucune question dans cette catégorie");
    let used = s.used[cat] || [];
    let free = pool.filter(i => !used.includes(i));
    if (free.length === 0) { used = []; free = pool; }
    const idx = free[this.rng(free.length)];
    used.push(idx);
    s.used[cat] = used;
    return idx;
  }

  land(cat: number, wedgeCase: boolean): Question {
    this.need("land");
    const s = this.s;
    s.category = cat;
    s.wedgeCase = !!wedgeCase;
    s.isFinal = false;
    s.questionIdx = this.draw(cat);
    s.phase = "question";
    return this.questions[s.questionIdx];
  }

  goFinal(): void {
    if (!this.canFinal()) throw new Error("Il faut les 6 camemberts");
    this.s.phase = "final-cat";
  }

  chooseFinal(cat: number): Question {
    this.need("final-cat");
    const s = this.s;
    s.category = cat;
    s.wedgeCase = false;
    s.isFinal = true;
    s.questionIdx = this.draw(cat);
    s.phase = "question";
    return this.questions[s.questionIdx];
  }

  reveal(): void {
    this.need("question");
    this.s.phase = "answer";
  }

  answer(correct: boolean): AnswerResult {
    this.need("answer");
    const s = this.s;
    const t = this.team;
    const res: AnswerResult = { gotWedge: false, won: false };
    if (s.isFinal) {
      if (correct) {
        s.winner = s.current;
        s.phase = "won";
        res.won = true;
      } else {
        this.next();
      }
    } else if (correct) {
      if (s.wedgeCase && s.category !== null && !t.wedges[s.category]) {
        t.wedges[s.category] = true;
        res.gotWedge = true;
      }
      s.phase = "roll"; // bonne réponse : la même équipe rejoue
    } else {
      this.next();
    }
    s.lastResult = correct ? "correct" : "wrong";
    s.isFinal = false;
    return res;
  }

  skipTurn(): void {
    if (this.s.phase === "won") return;
    this.next();
    this.s.lastResult = "skip";
  }

  private next(): void {
    const s = this.s;
    s.current = (s.current + 1) % s.teams.length;
    s.phase = "roll";
    s.dice = null;
    s.remaining = 0;
    s.steps = [];
  }

  currentQuestion(): Question | null {
    const s = this.s;
    return s.questionIdx == null ? null : this.questions[s.questionIdx];
  }
}
