/**
 * Minimal placeholder shell screen. Lives in src/shell/ — the token-only zone
 * the audit `no-literals` linter enforces: no literal colors, copy, or asset
 * paths here. All visible text is INJECTED (from the game's design/copy.ts) and
 * all styling resolves through `--fab-*` tokens (see design/tokens.css). A real
 * port deletes this and mounts screens from `@fabrikav2/ui`.
 */
export interface PlaceholderScreenOptions {
  mountInto: HTMLElement;
  /** Injected label copy — sourced from design/copy.ts, never hardcoded here. */
  label: string;
}

export function mountPlaceholderScreen(opts: PlaceholderScreenOptions): HTMLElement {
  const root = document.createElement("div");
  root.className = "fab-placeholder-screen";

  const label = document.createElement("p");
  label.className = "fab-placeholder-screen__label";
  label.textContent = opts.label;

  root.appendChild(label);
  opts.mountInto.appendChild(root);
  return root;
}
