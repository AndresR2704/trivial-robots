// Petits utilitaires d'interface : accès DOM, échappement HTML, toast, confirmation.

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" } as Record<string, string>
  )[c]);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string): void {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

let pendingConfirm: string | null = null;

/** Confirmation douce (double appui) sans boîte de dialogue bloquante. */
export function confirmAction(msg: string): boolean {
  if (pendingConfirm === msg) { pendingConfirm = null; return true; }
  pendingConfirm = msg;
  toast(msg + " (appuie à nouveau)");
  setTimeout(() => { if (pendingConfirm === msg) pendingConfirm = null; }, 2500);
  return false;
}
