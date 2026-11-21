// Logique de jeu Trivial Pursuit (sans UI, testable sous Node).
(function (root) {
  "use strict";

  const DIRS = ["UP", "RIGHT", "DOWN", "LEFT"];
  const OPPOSITE = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };
  const NB_CAT = 6;

  function defaultRng(n) {
    if (root.crypto && root.crypto.getRandomValues) {
      const a = new Uint32Array(1);
      root.crypto.getRandomValues(a);
      return a[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  class Game {
    constructor(questions, rng) {
      this.questions = questions;
      this.rng = rng || defaultRng;
      this.state = null;
    }

    newGame(teams) {
      if (!teams || teams.length < 1 || teams.length > 6) throw new Error("1 à 6 équipes");
      const robots = new Set(teams.map(t => t.robot));
      if (robots.size !== teams.length) throw new Error("Chaque équipe doit avoir un robot différent");
      this.state = {
        version: 1,
        teams: teams.map(t => ({ name: t.name, robot: t.robot, wedges: Array(NB_CAT).fill(false) })),
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

    load(state) { this.state = state; return state; }

    get team() { return this.state.teams[this.state.current]; }

    _need(phase) {
      const ok = Array.isArray(phase) ? phase.includes(this.state.phase) : this.state.phase === phase;
      if (!ok) throw new Error("Action impossible en phase " + this.state.phase);
    }

    canFinal() {
      return this.state.phase === "roll" && this.team.wedges.every(Boolean);
    }

    roll() {
      this._need("roll");
      const s = this.state;
      s.dice = this.rng(6) + 1;
      s.remaining = s.dice;
      s.steps = [];
      s.lastResult = null;
      s.phase = "move";
      return s.dice;
    }

    // Retourne la commande à envoyer { robot, dir }
    step(dir) {
      this._need("move");
      if (!DIRS.includes(dir)) throw new Error("Direction inconnue");
      const s = this.state;
      if (s.remaining <= 0) throw new Error("Plus de cases");
      s.remaining--;
      s.steps.push(dir);
      if (s.remaining === 0) s.phase = "land";
      return { robot: this.team.robot, dir };
    }

    undoStep() {
      this._need(["move", "land"]);
      const s = this.state;
      if (s.steps.length === 0) return null;
      const dir = s.steps.pop();
      s.remaining++;
      s.phase = "move";
      return { robot: this.team.robot, dir: OPPOSITE[dir] };
    }

    endMove() {
      this._need("move");
      this.state.phase = "land";
    }

    relance() {
      this._need("land");
      this.state.phase = "roll";
      this.state.lastResult = "relance";
    }

    _draw(cat) {
      const s = this.state;
      const pool = [];
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

    land(cat, wedgeCase) {
      this._need("land");
      const s = this.state;
      s.category = cat;
      s.wedgeCase = !!wedgeCase;
      s.isFinal = false;
      s.questionIdx = this._draw(cat);
      s.phase = "question";
      return this.questions[s.questionIdx];
    }

    goFinal() {
      if (!this.canFinal()) throw new Error("Il faut les 6 camemberts");
      this.state.phase = "final-cat";
    }

    chooseFinal(cat) {
      this._need("final-cat");
      const s = this.state;
      s.category = cat;
      s.wedgeCase = false;
      s.isFinal = true;
      s.questionIdx = this._draw(cat);
      s.phase = "question";
      return this.questions[s.questionIdx];
    }

    reveal() {
      this._need("question");
      this.state.phase = "answer";
    }

    // Retourne { gotWedge, won }
    answer(correct) {
      this._need("answer");
      const s = this.state;
      const t = this.team;
      const res = { gotWedge: false, won: false };
      if (s.isFinal) {
        if (correct) {
          s.winner = s.current;
          s.phase = "won";
          res.won = true;
        } else {
          this._next();
        }
      } else if (correct) {
        if (s.wedgeCase && !t.wedges[s.category]) {
          t.wedges[s.category] = true;
          res.gotWedge = true;
        }
        s.phase = "roll";        // bonne réponse : la même équipe rejoue
      } else {
        this._next();
      }
      s.lastResult = correct ? "correct" : "wrong";
      s.isFinal = false;
      return res;
    }

    skipTurn() {
      if (this.state.phase === "won") return;
      this._next();
      this.state.lastResult = "skip";
    }

    _next() {
      const s = this.state;
      s.current = (s.current + 1) % s.teams.length;
      s.phase = "roll";
      s.dice = null;
      s.remaining = 0;
      s.steps = [];
    }

    currentQuestion() {
      const s = this.state;
      return s.questionIdx == null ? null : this.questions[s.questionIdx];
    }
  }

  const api = { Game, DIRS, OPPOSITE, NB_CAT };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TrivialGame = api;
})(typeof window !== "undefined" ? window : globalThis);
