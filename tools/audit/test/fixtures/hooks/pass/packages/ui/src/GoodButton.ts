// An interactive component that threads a stable data-fab-* hook to its root.
export interface GoodButtonOptions {
  mountInto: HTMLElement;
  label: string;
  onClick: (event: MouseEvent) => void;
  dataAction?: string;
}

export function mountGoodButton(opts: GoodButtonOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = opts.label;
  if (opts.dataAction) button.dataset.fabAction = opts.dataAction;
  button.addEventListener('click', opts.onClick);
  opts.mountInto.appendChild(button);
  return button;
}
