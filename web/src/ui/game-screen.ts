// Écran de partie : tableau des scores + zone de jeu (une vue par phase).
import type { Dir, GameState } from "../game/game.ts";
import { CATEGORIES } from "../game/questions.ts";
import { cmd } from "../link/commands.ts";
import type { AppContext, Screen } from "./context.ts";
import { $, confirmAction, esc } from "./dom.ts";
import { bindPad, catButtons, padHTML, pieSVG, robotColor } from "./widgets.ts";

export function createGameScreen(ctx: AppContext): Screen {
  const { game, link, store } = ctx;
  let rolling = false;

  /** État de la partie (l'écran n'est affiché qu'avec une partie chargée). */
  function st(): GameState {
    return game.state as GameState;
  }

  function renderScoreboard(): void {
    const s = st();
    $("scoreboard").innerHTML = s.teams.map((t, i) => `
      <div class="score ${i === s.current ? "active" : ""}" data-robot="${t.robot}"${link.online[t.robot - 1] ? "" : ` data-offline="1"`} style="--team:${robotColor(t.robot)}">
        ${pieSVG(t.wedges)}
        <div class="info">
          <div class="name">${esc(t.name)}</div>
          <div class="robot" style="color:${robotColor(t.robot)}">Robot ${t.robot} · ${t.wedges.filter(Boolean).length}/6<span class="offline-tag"> · hors-ligne</span></div>
        </div>
      </div>`).join("");
  }

  function resultHTML(s: GameState): string {
    switch (s.lastResult) {
      case "correct": return `<div class="result good">Bonne réponse, ${esc(game.team.name)} rejoue !</div>`;
      case "wedge": return `<div class="result good">Camembert gagné, ${esc(game.team.name)} rejoue !</div>`;
      case "wrong": return `<div class="result bad">Mauvaise réponse, au tour de ${esc(game.team.name)}</div>`;
      case "relance": return `<div class="result neutral">Case Relance : relance le dé</div>`;
      case "skip": return `<div class="result neutral">Tour passé</div>`;
      default: return "";
    }
  }

  function render(): void {
    const s = st();
    renderScoreboard();
    const stage = $("stage");
    const t = game.team;
    const color = robotColor(t.robot);
    const header = `<div class="turn-label">Au tour de</div>
      <div class="turn-team" style="color:${color}">${esc(t.name)} <small style="font-size:18px;color:var(--muted)">· Robot ${t.robot}</small></div>`;

    switch (s.phase) {
      case "roll":
        stage.innerHTML = `${header}${resultHTML(s)}
          <div class="dice" id="dice">?</div>
          <button id="btn-roll" class="primary big">Lancer le dé</button>
          ${game.canFinal() ? `<button id="btn-final" class="ok big">Au centre : question finale</button>` : ""}`;
        $("btn-roll").onclick = doRoll;
        if (game.canFinal()) $("btn-final").onclick = () => { game.goFinal(); ctx.persist(); render(); };
        break;

      case "move":
        stage.innerHTML = `${header}
          <div class="row" style="align-items:center;gap:24px">
            <div class="dice">${s.dice}</div>
            <div class="remaining">Cases restantes<br><b>${s.remaining}</b></div>
          </div>
          ${padHTML("g")}
          <div class="row">
            <button id="btn-undo" class="ghost" ${s.steps.length ? "" : "disabled"}>Annuler un pas</button>
            <button id="btn-endmove" class="ghost">Terminer le déplacement</button>
          </div>`;
        bindPad("g", onGameDir);
        $("btn-undo").onclick = doUndo;
        $("btn-endmove").onclick = () => { game.endMove(); ctx.persist(); render(); };
        break;

      case "land":
        stage.innerHTML = `${header}
          <h2 style="margin:0">Sur quelle case est arrivé le robot ?</h2>
          <label class="toggle"><input type="checkbox" id="chk-wedge"> Case camembert</label>
          ${catButtons("data-cat")}
          <div class="row">
            <button id="btn-relance" class="ghost">Case Relance</button>
            <button id="btn-undo" class="ghost">Annuler un pas</button>
          </div>`;
        stage.querySelectorAll<HTMLElement>("[data-cat]").forEach(b => b.onclick = () => {
          game.land(+(b.dataset.cat as string), $<HTMLInputElement>("chk-wedge").checked);
          ctx.persist();
          render();
        });
        $("btn-relance").onclick = () => { game.relance(); ctx.persist(); render(); };
        $("btn-undo").onclick = doUndo;
        break;

      case "final-cat":
        stage.innerHTML = `${header}
          <div class="final-tag">QUESTION FINALE</div>
          <h2 style="margin:0">Les adversaires choisissent la catégorie</h2>
          ${catButtons("data-final")}`;
        stage.querySelectorAll<HTMLElement>("[data-final]").forEach(b => b.onclick = () => {
          game.chooseFinal(+(b.dataset.final as string));
          ctx.persist();
          render();
        });
        break;

      case "question":
      case "answer": {
        const q = game.currentQuestion();
        if (!q || s.category === null) break;
        const cat = CATEGORIES[s.category];
        stage.innerHTML = `
          ${s.isFinal ? `<div class="final-tag">QUESTION FINALE</div>` : ""}
          <div class="cat-banner" style="background:${cat.color}">${esc(cat.name)}${s.wedgeCase ? " · camembert" : ""}</div>
          <div class="question">${esc(q.q)}</div>
          ${s.phase === "answer"
            ? `<div class="answer">${esc(q.a)}</div>
               <div class="row">
                 <button id="btn-ok" class="ok big">✓ Bonne réponse</button>
                 <button id="btn-ko" class="danger big">✗ Mauvaise réponse</button>
               </div>`
            : `<button id="btn-reveal" class="primary big">Afficher la réponse</button>`}
          <div class="turn-label">${esc(t.name)} · Robot ${t.robot}</div>`;
        if (s.phase === "question") {
          $("btn-reveal").onclick = () => { game.reveal(); ctx.persist(); render(); };
        } else {
          $("btn-ok").onclick = () => doAnswer(true);
          $("btn-ko").onclick = () => doAnswer(false);
        }
        break;
      }

      case "won": {
        const winner = s.teams[s.winner as number];
        stage.innerHTML = `<div class="trophy">🏆</div>
          <div class="turn-team" style="color:${robotColor(winner.robot)}">${esc(winner.name)} gagne !</div>
          <div class="row">
            <button id="btn-win-anim" class="ghost">Rejouer l'animation</button>
            <button id="btn-again" class="primary big">Nouvelle partie</button>
          </div>`;
        $("btn-win-anim").onclick = () => link.send(cmd.win(winner.robot));
        $("btn-again").onclick = () => { store.game = null; ctx.save(); ctx.go("setup"); };
        break;
      }
    }
  }

  function doRoll(): void {
    if (rolling) return;
    rolling = true;
    const d = $("dice");
    d.classList.add("rolling");
    $<HTMLButtonElement>("btn-roll").disabled = true;
    // Animation purement visuelle ; le tirage réel est fait par game.roll()
    const iv = setInterval(() => { d.textContent = String(1 + Math.floor(Math.random() * 6)); }, 70);
    setTimeout(() => {
      clearInterval(iv);
      game.roll();
      ctx.persist();
      rolling = false;
      render();
    }, 700);
  }

  function onGameDir(dir: Dir): void {
    if (!link.ensureOpen()) return;
    const move = game.step(dir);
    link.send(cmd.move(move.robot, move.dir));
    ctx.persist();
    render();
  }

  function doUndo(): void {
    if (!link.ensureOpen()) return;
    const move = game.undoStep();
    if (move) link.send(cmd.move(move.robot, move.dir));
    ctx.persist();
    render();
  }

  function doAnswer(correct: boolean): void {
    const res = game.answer(correct);
    const s = st();
    if (res.gotWedge) s.lastResult = "wedge";
    if (res.won) link.send(cmd.win(s.teams[s.winner as number].robot));
    ctx.persist();
    render();
  }

  // ---------- Barre du haut (visible pendant la partie) ----------
  $("btn-skip").onclick = () => {
    if (!confirmAction("Passer le tour de " + game.team.name + " ?")) return;
    game.skipTurn();
    ctx.persist();
    render();
  };

  $("btn-new").onclick = () => {
    if (st().phase !== "won" && !confirmAction("Abandonner la partie en cours ?")) return;
    store.game = null;
    ctx.save();
    ctx.go("setup");
  };

  return { render };
}
