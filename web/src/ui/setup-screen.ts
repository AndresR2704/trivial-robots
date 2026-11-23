// Écran de configuration : équipes, adresse du maître, reprise de partie.
import type { TeamInput } from "../game/game.ts";
import { cmd } from "../link/commands.ts";
import type { AppContext, Screen } from "./context.ts";
import { $, toast } from "./dom.ts";
import { robotColor } from "./widgets.ts";

export function createSetupScreen(ctx: AppContext): Screen {
  const { game, link, store } = ctx;

  const setupTeams: TeamInput[] = store.setupTeams || [
    { name: "Équipe 1", robot: 1 },
    { name: "Équipe 2", robot: 2 },
  ];

  function saveSetup(): void {
    store.setupTeams = setupTeams;
    ctx.save();
  }

  function render(): void {
    const list = $("team-list");
    list.innerHTML = "";
    setupTeams.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "team-row";
      const dot = document.createElement("div");
      dot.className = "team-dot";
      dot.dataset.robot = String(t.robot);
      if (!link.online[t.robot - 1]) dot.dataset.offline = "1";
      dot.style.background = robotColor(t.robot);
      dot.textContent = "R" + t.robot;

      const name = document.createElement("input");
      name.value = t.name;
      name.maxLength = 24;
      name.oninput = () => { t.name = name.value; saveSetup(); };

      const sel = document.createElement("select");
      for (let r = 1; r <= 6; r++) {
        const o = document.createElement("option");
        o.value = String(r);
        o.textContent = "Robot " + r;
        if (r === t.robot) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => { t.robot = +sel.value; saveSetup(); render(); };

      const del = document.createElement("button");
      del.className = "ghost";
      del.textContent = "✕";
      del.disabled = setupTeams.length <= 1;
      del.onclick = () => { setupTeams.splice(i, 1); saveSetup(); render(); };

      row.append(dot, name, sel, del);
      list.appendChild(row);
    });
    $<HTMLButtonElement>("btn-add-team").disabled = setupTeams.length >= 6;
    $<HTMLInputElement>("master-url").value = link.url;
    const hasGame = !!(store.game && store.game.phase && store.game.phase !== "won");
    $("resume-box").classList.toggle("hidden", !hasGame);
  }

  $("btn-add-team").onclick = () => {
    const usedR = setupTeams.map(t => t.robot);
    const free = [1, 2, 3, 4, 5, 6].find(r => !usedR.includes(r));
    setupTeams.push({ name: "Équipe " + (setupTeams.length + 1), robot: free || 1 });
    saveSetup();
    render();
  };

  $<HTMLInputElement>("master-url").onchange = (e) => {
    const url = (e.target as HTMLInputElement).value.trim();
    store.url = url;
    ctx.save();
    link.setUrl(url);
  };

  $("btn-start").onclick = () => {
    const teams = setupTeams.map((t, i) => ({ name: t.name.trim() || "Équipe " + (i + 1), robot: t.robot }));
    try {
      game.newGame(teams);
    } catch (e) {
      toast((e as Error).message);
      return;
    }
    link.send(cmd.anim("ALL"));
    ctx.persist();
    ctx.go("game");
  };

  $("btn-resume").onclick = () => {
    if (store.game) game.load(store.game);
    ctx.go("game");
  };

  return { render };
}
