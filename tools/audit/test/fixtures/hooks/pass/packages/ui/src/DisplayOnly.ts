// A non-interactive display component: no interaction option, so out of scope
// for the hook rule even though it has no data-fab-* attribute.
export interface DisplayOnlyOptions {
  mountInto: HTMLElement;
  text: string;
}

export function mountDisplayOnly(opts: DisplayOnlyOptions): HTMLElement {
  const el = document.createElement('div');
  el.textContent = opts.text;
  opts.mountInto.appendChild(el);
  return el;
}
