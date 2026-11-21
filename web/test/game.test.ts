// Tests des règles du jeu (node --test).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Game, NB_CAT, type GameState, type Question, type Rng } from "../src/game/game.ts";
import { CATEGORIES, QUESTIONS } from "../src/game/questions.ts";

/** Générateur déterministe : renvoie les valeurs données, puis 0. */
function seq(...values: number[]): Rng {
  return (n) => {
    const v = values.length ? (values.shift() as number) : 0;
    assert.ok(v >= 0 && v < n, `valeur ${v} hors de [0, ${n})`);
    return v;
  };
}

const TEAMS = [{ name: "A", robot: 1 }, { name: "B", robot: 2 }, { name: "C", robot: 3 }];

/** 2 questions par catégorie : suffisant pour tester l'épuisement d'une catégorie. */
const SMALL: Question[] = Array.from({ length: NB_CAT * 2 }, (_, i) => ({ c: i % NB_CAT, q: `q${i}`, a: `a${i}` }));

function newGame(rng: Rng = seq(), questions: readonly Question[] = SMALL): Game {
  const g = new Game(questions, rng);
  g.newGame(TEAMS);
  return g;
}

function st(g: Game): GameState {
  return g.state as GameState;
}

/** Amène l'équipe courante jusqu'à la question (1 pas vers le haut, puis fin du déplacement). */
function toQuestion(g: Game, cat: number, wedge: boolean): void {
  g.roll();
  g.step("UP");
  if (st(g).phase === "move") g.endMove();
  g.land(cat, wedge);
  g.reveal();
}

describe("banque de questions", () => {
  it("6 catégories, chacune avec des questions", () => {
    assert.equal(CATEGORIES.length, NB_CAT);
    for (let c = 0; c < NB_CAT; c++) {
      assert.ok(QUESTIONS.some(q => q.c === c), `catégorie ${c} vide`);
    }
    assert.ok(QUESTIONS.every(q => q.c >= 0 && q.c < NB_CAT && q.q && q.a));
  });
});

describe("création de partie", () => {
  it("refuse 0 ou plus de 6 équipes", () => {
    const g = new Game(SMALL);
    assert.throws(() => g.newGame([]), /1 à 6 équipes/);
    const seven = Array.from({ length: 7 }, (_, i) => ({ name: `E${i}`, robot: i + 1 }));
    assert.throws(() => g.newGame(seven), /1 à 6 équipes/);
  });

  it("refuse deux équipes sur le même robot", () => {
    const g = new Game(SMALL);
    assert.throws(() => g.newGame([{ name: "A", robot: 1 }, { name: "B", robot: 1 }]), /robot différent/);
  });

  it("démarre en phase roll, première équipe, aucun camembert", () => {
    const g = newGame();
    assert.equal(st(g).phase, "roll");
    assert.equal(g.team.name, "A");
    assert.ok(st(g).teams.every(t => t.wedges.length === NB_CAT && t.wedges.every(w => !w)));
  });

  it("refuse toute action sans partie chargée", () => {
    assert.throws(() => new Game(SMALL).roll(), /Aucune partie/);
  });
});

describe("dé et déplacement", () => {
  it("le dé donne 1 à 6 et autant de cases à parcourir", () => {
    const g = newGame(seq(4));
    assert.equal(g.roll(), 5);
    assert.equal(st(g).remaining, 5);
    assert.equal(st(g).phase, "move");
  });

  it("chaque pas renvoie la commande du robot courant ; le dernier pas mène à land", () => {
    const g = newGame(seq(1)); // dé = 2
    g.roll();
    assert.deepEqual(g.step("UP"), { robot: 1, dir: "UP" });
    assert.equal(st(g).phase, "move");
    assert.deepEqual(g.step("LEFT"), { robot: 1, dir: "LEFT" });
    assert.equal(st(g).phase, "land");
    assert.throws(() => g.step("UP"), /phase land/);
  });

  it("annuler un pas renvoie la direction opposée et rend la case", () => {
    const g = newGame(seq(0)); // dé = 1
    g.roll();
    g.step("RIGHT");
    assert.deepEqual(g.undoStep(), { robot: 1, dir: "LEFT" });
    assert.equal(st(g).remaining, 1);
    assert.equal(st(g).phase, "move");
    assert.equal(g.undoStep(), null);
  });

  it("refuse une direction inconnue", () => {
    const g = newGame();
    g.roll();
    assert.throws(() => g.step("NORD" as never), /Direction inconnue/);
  });

  it("terminer le déplacement avant la fin du dé", () => {
    const g = newGame(seq(5)); // dé = 6
    g.roll();
    g.step("UP");
    g.endMove();
    assert.equal(st(g).phase, "land");
  });

  it("case Relance : la même équipe relance", () => {
    const g = newGame();
    g.roll();
    g.step("UP");
    g.relance();
    assert.equal(st(g).phase, "roll");
    assert.equal(st(g).lastResult, "relance");
    assert.equal(g.team.name, "A");
  });
});

describe("questions et réponses", () => {
  it("la question tirée appartient à la catégorie de la case", () => {
    const g = newGame();
    g.roll();
    g.step("UP");
    const q = g.land(3, false);
    assert.equal(q.c, 3);
    assert.equal(st(g).phase, "question");
    assert.equal(g.currentQuestion(), q);
  });

  it("pas de répétition tant que la catégorie n'est pas épuisée", () => {
    const g = newGame();
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      toQuestion(g, 0, false);
      seen.push((g.currentQuestion() as Question).q);
      g.answer(true);
    }
    assert.notEqual(seen[0], seen[1]);          // 2 questions distinctes dans la catégorie
    assert.ok(seen.slice(0, 2).includes(seen[2])); // catégorie épuisée : on recommence
  });

  it("bonne réponse : la même équipe rejoue", () => {
    const g = newGame();
    toQuestion(g, 0, false);
    assert.deepEqual(g.answer(true), { gotWedge: false, won: false });
    assert.equal(g.team.name, "A");
    assert.equal(st(g).phase, "roll");
    assert.equal(st(g).lastResult, "correct");
  });

  it("mauvaise réponse : équipe suivante, et retour à la première après la dernière", () => {
    const g = newGame();
    for (const expected of ["B", "C", "A"]) {
      toQuestion(g, 0, false);
      g.answer(false);
      assert.equal(g.team.name, expected);
    }
    assert.equal(st(g).lastResult, "wrong");
    assert.equal(st(g).dice, null);
  });

  it("camembert gagné seulement sur une case camembert avec bonne réponse", () => {
    const g = newGame();
    toQuestion(g, 2, false);
    g.answer(true);
    assert.equal(g.team.wedges[2], false);

    toQuestion(g, 2, true);
    assert.deepEqual(g.answer(true), { gotWedge: true, won: false });
    assert.equal(g.team.wedges[2], true);

    toQuestion(g, 2, true); // déjà gagné : pas de nouveau camembert
    assert.equal(g.answer(true).gotWedge, false);
  });
});

describe("question finale", () => {
  function withAllWedges(): Game {
    const g = newGame();
    st(g).teams[0].wedges.fill(true);
    return g;
  }

  it("impossible sans les 6 camemberts", () => {
    const g = newGame();
    assert.equal(g.canFinal(), false);
    assert.throws(() => g.goFinal(), /6 camemberts/);
  });

  it("bonne réponse à la finale : victoire", () => {
    const g = withAllWedges();
    assert.equal(g.canFinal(), true);
    g.goFinal();
    assert.equal(st(g).phase, "final-cat");
    assert.equal(g.chooseFinal(4).c, 4);
    assert.equal(st(g).isFinal, true);
    g.reveal();
    assert.deepEqual(g.answer(true), { gotWedge: false, won: true });
    assert.equal(st(g).phase, "won");
    assert.equal(st(g).winner, 0);
  });

  it("mauvaise réponse à la finale : équipe suivante", () => {
    const g = withAllWedges();
    g.goFinal();
    g.chooseFinal(1);
    g.reveal();
    g.answer(false);
    assert.equal(g.team.name, "B");
    assert.equal(st(g).isFinal, false);
    assert.equal(st(g).winner, null);
  });
});

describe("passer le tour et sauvegarde", () => {
  it("passer le tour donne la main à l'équipe suivante, sauf partie gagnée", () => {
    const g = newGame();
    g.skipTurn();
    assert.equal(g.team.name, "B");
    assert.equal(st(g).lastResult, "skip");
    st(g).phase = "won";
    g.skipTurn();
    assert.equal(g.team.name, "B");
  });

  it("l'état survit à un aller-retour JSON (reprise de partie)", () => {
    const g = newGame(seq(2));
    toQuestion(g, 5, true);
    g.answer(true);
    const restored = new Game(SMALL, seq());
    restored.load(JSON.parse(JSON.stringify(g.state)));
    assert.deepEqual(restored.state, g.state);
    // les questions déjà posées restent exclues après reprise
    toQuestion(restored, 5, false);
    assert.notEqual(restored.currentQuestion(), g.currentQuestion());
  });
});
