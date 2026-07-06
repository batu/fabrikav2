// An interactive component that renders a clickable element with NO stable hook
// — only drivable via el.click() / engine shortcut (the dead-menu-buttons trap).
export interface BadButtonOptions {
  mountInto: HTMLElement;
  label: string;
  onClick: (event: MouseEvent) => void;
}

export function mountBadButton(opts: BadButtonOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = opts.label;
  button.addEventListener('click', opts.onClick);
  opts.mountInto.appendChild(button);
  return button;
}
