// Interface + liaison WebSocket avec l'ESP32 maître.
(function () {
  "use strict";

  const CATS = window.CATEGORIES;
  const { Game } = window.TrivialGame;
  const ROBOT_COLORS = ["#ff6b6b", "#4dabf7", "#a9e34b", "#b197fc", "#ffd43b", "#63e6be"];
  const STORE_KEY = "trivial-robots-v1";
  const $ = (id) => document.getElementById(id);

  // ---------- Stockage (tolérant aux erreurs) ----------
  function save(data) { try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {} }
  function loadStore() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
  let store = loadStore();

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  // ---------- Liaison maître ----------
  const link = {
    url: store.url || "ws://192.168.4.1:81",
    ws: null,
    open: false,
    lastRx: 0,
    timer: null,

    connect() {
      clearTimeout(this.timer);
      if (this.ws) { try { this.ws.onclose = null; this.ws.close(); } catch (e) {} }
      setConn("wait", "Connexion…");
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { this.retry(); return; }
      this.ws = ws;
      ws.onopen = () => { this.open = true; this.lastRx = Date.now(); setConn("on", "Maître connecté"); };
      ws.onmessage = (ev) => {
        this.lastRx = Date.now();
        const m = String(ev.data);
        if (m.startsWith("ERR")) toast("Maître : " + m);
      };
      ws.onerror = () => {};
      ws.onclose = () => { this.open = false; setConn("off", "Maître déconnecté"); this.retry(); };
    },
    retry() { clearTimeout(this.timer); this.timer = setTimeout(() => this.connect(), 2000); },
    send(text) {
      if (!this.open || !this.ws || this.ws.readyState !== 1) {
        toast("Maître non connecté : vérifie le WiFi TrivialRobots");
        return false;
      }
      this.ws.send(text);
      return true;
    },
    setUrl(url) { this.url = url; store.url = url; save(store); this.connect(); },
  };

  function setConn(cls, label) {
    const c = $("conn");
    c.className = "pill " + cls;
    c.textContent = label;
  }

  // Keepalive : PING toutes les 4 s, reconnexion si rien reçu depuis 10 s
  setInterval(() => {
    if (link.open && link.ws) {
      try { link.ws.send("PING"); } catch (e) {}
      if (Date.now() - link.lastRx > 10000) { try { link.ws.close(); } catch (e) {} }
    }
  }, 4000);

  // ---------- Jeu ----------
  const game = new Game(window.QUESTIONS);
  let view = "setup";
  let prevView = "setup";
  let rolling = false;

  function persist() { store.game = game.state; save(store); }

  function show(name) {
    if (name !== "manual") prevView = name;
    view = name;
    ["setup", "game", "manual"].forEach(n => $("screen-" + n).classList.toggle("hidden", n !== name));
    const inGame = name === "game";
    $("btn-skip").classList.toggle("hidden", !inGame);
    $("btn-new").classList.toggle("hidden", !inGame);
    $("btn-manual").classList.toggle("hidden", name === "manual");
  }

  // ---------- Écran configuration ----------
  let setupTeams = store.setupTeams || [
    { name: "Équipe 1", robot: 1 },
    { name: "Équipe 2", robot: 2 },
  ];

  function renderSetup() {
    const list = $("team-list");
    list.innerHTML = "";
    setupTeams.forEach((t, i) => {
      const row = document.createElement("div");
      row.className = "team-row";
      const dot = document.createElement("div");
      dot.className = "team-dot";
      dot.style.background = ROBOT_COLORS[t.robot - 1];
      dot.textContent = "R" + t.robot;

      const name = document.createElement("input");
      name.value = t.name;
      name.maxLength = 24;
      name.oninput = () => { t.name = name.value; saveSetup(); };

      const sel = document.createElement("select");
      for (let r = 1; r <= 6; r++) {
        const o = document.createElement("option");
        o.value = r; o.textContent = "Robot " + r;
        if (r === t.robot) o.selected = true;
        sel.appendChild(o);
      }
      sel.onchange = () => { t.robot = +sel.value; saveSetup(); renderSetup(); };

      const del = document.createElement("button");
      del.className = "ghost";
      del.textContent = "✕";
      del.disabled = setupTeams.length <= 1;
      del.onclick = () => { setupTeams.splice(i, 1); saveSetup(); renderSetup(); };

      row.append(dot, name, sel, del);
      list.appendChild(row);
    });
    $("btn-add-team").disabled = setupTeams.length >= 6;
    $("master-url").value = link.url;
    const hasGame = store.game && store.game.phase && store.game.phase !== "won";
    $("resume-box").classList.toggle("hidden", !hasGame);
  }
  function saveSetup() { store.setupTeams = setupTeams; save(store); }

  $("btn-add-team").onclick = () => {
    const usedR = setupTeams.map(t => t.robot);
    const free = [1, 2, 3, 4, 5, 6].find(r => !usedR.includes(r));
    setupTeams.push({ name: "Équipe " + (setupTeams.length + 1), robot: free || 1 });
    saveSetup(); renderSetup();
  };

  $("master-url").onchange = (e) => link.setUrl(e.target.value.trim());

  $("btn-start").onclick = () => {
    const teams = setupTeams.map((t, i) => ({ name: t.name.trim() || "Équipe " + (i + 1), robot: t.robot }));
    try { game.newGame(teams); } catch (e) { toast(e.message); return; }
    link.send("ANIM ALL");
    persist();
    show("game");
    renderGame();
  };

  $("btn-resume").onclick = () => {
    game.load(store.game);
    show("game");
    renderGame();
  };

  // ---------- Barre du haut ----------
  $("btn-manual").onclick = () => { show("manual"); renderManual(); };
  $("btn-skip").onclick = () => {
    if (!confirmAction("Passer le tour de " + game.team.name + " ?")) return;
    game.skipTurn(); persist(); renderGame();
  };
  $("btn-new").onclick = () => {
    if (game.state.phase !== "won" && !confirmAction("Abandonner la partie en cours ?")) return;
    store.game = null; save(store);
    show("setup"); renderSetup();
  };

  // Confirmation douce (double appui) sans boîte de dialogue bloquante
  let pendingConfirm = null;
  function confirmAction(msg) {
    if (pendingConfirm === msg) { pendingConfirm = null; return true; }
    pendingConfirm = msg;
    toast(msg + " (appuie à nouveau)");
    setTimeout(() => { if (pendingConfirm === msg) pendingConfirm = null; }, 2500);
    return false;
  }

  // ---------- Rendu partie ----------
  function pieSVG(wedges) {
    const cx = 27, cy = 27, r = 24;
    let paths = "";
    for (let i = 0; i < 6; i++) {
      const a0 = (i * 60 - 90) * Math.PI / 180, a1 = ((i + 1) * 60 - 90) * Math.PI / 180;
      const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const fill = wedges[i] ? CATS[i].color : "#2a3450";
      paths += `<path d="M${cx},${cy} L${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)} Z" fill="${fill}" stroke="#182032" stroke-width="2"/>`;
    }
    return `<svg class="pie" viewBox="0 0 54 54">${paths}<circle cx="${cx}" cy="${cy}" r="6" fill="#182032"/></svg>`;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderScoreboard() {
    const s = game.state;
    $("scoreboard").innerHTML = s.teams.map((t, i) => `
      <div class="score ${i === s.current ? "active" : ""}" style="--team:${ROBOT_COLORS[t.robot - 1]}">
        ${pieSVG(t.wedges)}
        <div class="info">
          <div class="name">${esc(t.name)}</div>
          <div class="robot" style="color:${ROBOT_COLORS[t.robot - 1]}">Robot ${t.robot} · ${t.wedges.filter(Boolean).length}/6</div>
        </div>
      </div>`).join("");
  }

  function padHTML(prefix) {
    return `<div class="pad">
      <button class="up" data-dir="UP" id="${prefix}-UP">▲</button>
      <button class="left" data-dir="LEFT" id="${prefix}-LEFT">◀</button>
      <div class="center">${prefix === "g" ? "1 appui<br>= 1 case" : ""}</div>
      <button class="right" data-dir="RIGHT" id="${prefix}-RIGHT">▶</button>
      <button class="down" data-dir="DOWN" id="${prefix}-DOWN">▼</button>
    </div>`;
  }

  function catButtons(attr) {
    return `<div class="cats">${CATS.map((c, i) =>
      `<button class="cat-btn" ${attr}="${i}" style="background:${c.color}">${esc(c.name)}</button>`).join("")}</div>`;
  }

  function resultHTML(s) {
    switch (s.lastResult) {
      case "correct": return `<div class="result good">Bonne réponse, ${esc(game.team.name)} rejoue !</div>`;
      case "wedge": return `<div class="result good">Camembert gagné, ${esc(game.team.name)} rejoue !</div>`;
      case "wrong": return `<div class="result bad">Mauvaise réponse, au tour de ${esc(game.team.name)}</div>`;
      case "relance": return `<div class="result neutral">Case Relance : relance le dé</div>`;
      case "skip": return `<div class="result neutral">Tour passé</div>`;
      default: return "";
    }
  }

  function renderGame() {
    const s = game.state;
    renderScoreboard();
    const st = $("stage");
    const t = game.team;
    const color = ROBOT_COLORS[t.robot - 1];
    const header = `<div class="turn-label">Au tour de</div>
      <div class="turn-team" style="color:${color}">${esc(t.name)} <small style="font-size:18px;color:var(--muted)">· Robot ${t.robot}</small></div>`;

    switch (s.phase) {
      case "roll":
        st.innerHTML = `${header}${resultHTML(s)}
          <div class="dice" id="dice">?</div>
          <button id="btn-roll" class="primary big">Lancer le dé</button>
          ${game.canFinal() ? `<button id="btn-final" class="ok big">Au centre : question finale</button>` : ""}`;
        $("btn-roll").onclick = doRoll;
        if (game.canFinal()) $("btn-final").onclick = () => { game.goFinal(); persist(); renderGame(); };
        break;

      case "move":
        st.innerHTML = `${header}
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
        $("btn-endmove").onclick = () => { game.endMove(); persist(); renderGame(); };
        break;

      case "land":
        st.innerHTML = `${header}
          <h2 style="margin:0">Sur quelle case est arrivé le robot ?</h2>
          <label class="toggle"><input type="checkbox" id="chk-wedge"> Case camembert</label>
          ${catButtons("data-cat")}
          <div class="row">
            <button id="btn-relance" class="ghost">Case Relance</button>
            <button id="btn-undo" class="ghost">Annuler un pas</button>
          </div>`;
        st.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => {
          game.land(+b.dataset.cat, $("chk-wedge").checked); persist(); renderGame();
        });
        $("btn-relance").onclick = () => { game.relance(); persist(); renderGame(); };
        $("btn-undo").onclick = doUndo;
        break;

      case "final-cat":
        st.innerHTML = `${header}
          <div class="final-tag">QUESTION FINALE</div>
          <h2 style="margin:0">Les adversaires choisissent la catégorie</h2>
          ${catButtons("data-final")}`;
        st.querySelectorAll("[data-final]").forEach(b => b.onclick = () => {
          game.chooseFinal(+b.dataset.final); persist(); renderGame();
        });
        break;

      case "question":
      case "answer": {
        const q = game.currentQuestion();
        const cat = CATS[s.category];
        st.innerHTML = `
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
        if (s.phase === "question") $("btn-reveal").onclick = () => { game.reveal(); persist(); renderGame(); };
        else {
          $("btn-ok").onclick = () => doAnswer(true);
          $("btn-ko").onclick = () => doAnswer(false);
        }
        break;
      }

      case "won":
        st.innerHTML = `<div class="trophy">🏆</div>
          <div class="turn-team" style="color:${ROBOT_COLORS[s.teams[s.winner].robot - 1]}">${esc(s.teams[s.winner].name)} gagne !</div>
          <div class="row">
            <button id="btn-win-anim" class="ghost">Rejouer l'animation</button>
            <button id="btn-again" class="primary big">Nouvelle partie</button>
          </div>`;
        $("btn-win-anim").onclick = () => link.send("WIN " + s.teams[s.winner].robot);
        $("btn-again").onclick = () => { store.game = null; save(store); show("setup"); renderSetup(); };
        break;
    }
  }

  function doRoll() {
    if (rolling) return;
    rolling = true;
    const d = $("dice");
    d.classList.add("rolling");
    $("btn-roll").disabled = true;
    const iv = setInterval(() => { d.textContent = 1 + Math.floor(Math.random() * 6); }, 70);
    setTimeout(() => {
      clearInterval(iv);
      game.roll();
      persist();
      rolling = false;
      renderGame();
    }, 700);
  }

  function onGameDir(dir) {
    if (!link.open) { link.send(""); return; }       // affiche l'erreur de connexion
    const cmd = game.step(dir);
    link.send(`MOVE ${cmd.robot} ${cmd.dir}`);
    persist();
    renderGame();
  }

  function doUndo() {
    if (!link.open) { link.send(""); return; }
    const cmd = game.undoStep();
    if (cmd) link.send(`MOVE ${cmd.robot} ${cmd.dir}`);
    persist();
    renderGame();
  }

  function doAnswer(correct) {
    const res = game.answer(correct);
    if (res.gotWedge) game.state.lastResult = "wedge";
    if (res.won) link.send("WIN " + game.state.teams[game.state.winner].robot);
    persist();
    renderGame();
  }

  function bindPad(prefix, handler) {
    ["UP", "DOWN", "LEFT", "RIGHT"].forEach(d => {
      const b = $(`${prefix}-${d}`);
      if (b) b.onclick = () => handler(d);
    });
  }

  // ---------- Mode manuel ----------
  let manualTarget = "1";
  function renderManual() {
    const seg = $("manual-robots");
    const opts = ["1", "2", "3", "4", "5", "6", "ALL"];
    seg.innerHTML = opts.map(o =>
      `<button class="ghost ${o === manualTarget ? "sel" : ""}" data-r="${o}">${o === "ALL" ? "Tous" : "R" + o}</button>`).join("");
    seg.querySelectorAll("[data-r]").forEach(b => b.onclick = () => { manualTarget = b.dataset.r; renderManual(); });
    $("manual-pad").innerHTML = padHTML("m");
    bindPad("m", (d) => link.send(`MOVE ${manualTarget} ${d}`));
  }
  $("m-anim").onclick = () => link.send("ANIM " + manualTarget);
  $("m-win").onclick = () => link.send("WIN " + manualTarget);
  $("m-stop").onclick = () => link.send("STOP ALL");
  $("m-back").onclick = goBackFromManual;

  function goBackFromManual() {
    show(prevView);
    if (prevView === "game") renderGame(); else renderSetup();
  }

  // Bouton retour Android (appelé par MainActivity). true = géré.
  window.onAndroidBack = function () {
    if (view === "manual") { goBackFromManual(); return true; }
    if (view === "game") { toast("Utilise « Nouvelle partie » pour quitter la partie"); return true; }
    return false;
  };

  // ---------- Démarrage ----------
  show("setup");
  renderSetup();
  link.connect();
})();
