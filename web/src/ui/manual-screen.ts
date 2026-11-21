// Mode manuel : placer ou tester un robot (ou tous), hors partie.
import { cmd, type Target } from "../link/commands.ts";
import type { AppContext, Screen } from "./context.ts";
import { $ } from "./dom.ts";
import { bindPad, padHTML } from "./widgets.ts";

const TARGETS: readonly Target[] = [1, 2, 3, 4, 5, 6, "ALL"];

export function createManualScreen(ctx: AppContext): Screen {
  const { link } = ctx;
  let target: Target = 1;

  function render(): void {
    const seg = $("manual-robots");
    seg.innerHTML = TARGETS.map(o =>
      `<button class="ghost ${o === target ? "sel" : ""}" data-r="${o}">${o === "ALL" ? "Tous" : "R" + o}</button>`).join("");
    seg.querySelectorAll<HTMLElement>("[data-r]").forEach(b => b.onclick = () => {
      const r = b.dataset.r as string;
      target = r === "ALL" ? "ALL" : Number(r);
      render();
    });
    $("manual-pad").innerHTML = padHTML("m");
    bindPad("m", (d) => link.send(cmd.move(target, d)));
  }

  $("m-anim").onclick = () => link.send(cmd.anim(target));
  $("m-win").onclick = () => link.send(cmd.win(target));
  $("m-stop").onclick = () => link.send(cmd.stop("ALL"));
  $("m-back").onclick = () => ctx.back();

  return { render };
}
