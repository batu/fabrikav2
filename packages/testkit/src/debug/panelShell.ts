export interface DebugPanelShellOptions {
  id: string;
  title: string;
  width?: number;
  document?: Document;
  onClose?: () => void;
}

export interface DebugPanelShell {
  panel: HTMLElement;
  body: HTMLDivElement;
  remove(): boolean;
}

export function applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, styles);
}

export function removeDebugPanel(id: string, doc: Document = document): boolean {
  const existing = doc.getElementById(id);
  if (!existing) return false;
  existing.remove();
  return true;
}

export function mountDebugPanel(options: DebugPanelShellOptions): DebugPanelShell {
  const {
    id,
    title,
    width = 240,
    document: doc = document,
  } = options;

  const panel = doc.createElement('aside');
  panel.id = id;
  applyStyles(panel, {
    position: 'fixed',
    top: '8px',
    right: '8px',
    zIndex: '99999',
    width: `${width}px`,
    maxHeight: '85vh',
    maxWidth: 'calc(100vw - 24px)',
    overflowY: 'auto',
    padding: '10px',
    borderRadius: '10px',
    background: 'rgba(8, 14, 30, 0.92)',
    border: '1px solid rgba(96, 165, 250, 0.3)',
    color: '#e0eaff',
    fontFamily: "'Nunito', 'Trebuchet MS', sans-serif",
    display: 'grid',
    gap: '8px',
  });

  const titleBar = doc.createElement('div');
  applyStyles(titleBar, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  });

  const titleEl = doc.createElement('div');
  titleEl.textContent = title;
  applyStyles(titleEl, {
    fontWeight: '700',
    fontSize: '13px',
  });

  const collapseBtn = doc.createElement('button');
  collapseBtn.textContent = '\u25BE';
  collapseBtn.title = 'Toggle panel';
  collapseBtn.setAttribute('aria-label', 'Collapse panel');
  collapseBtn.setAttribute(
    'style',
    'min-width:36px;min-height:36px;background:rgba(255,255,255,0.06);border:1px solid rgba(157,208,255,0.3);color:#e0eaff;cursor:pointer;font-size:16px;padding:4px 8px;border-radius:8px;line-height:1',
  );

  const closeBtn = doc.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '\u00D7';
  closeBtn.title = 'Close panel';
  closeBtn.setAttribute('aria-label', 'Close panel');
  closeBtn.setAttribute(
    'style',
    'min-width:36px;min-height:36px;background:rgba(248,113,113,0.12);border:1px solid rgba(248,113,113,0.35);color:#fecaca;cursor:pointer;font-size:22px;padding:2px 8px;border-radius:8px;line-height:1',
  );
  const titleActions = doc.createElement('div');
  applyStyles(titleActions, {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  });
  titleActions.append(collapseBtn, closeBtn);

  const body = doc.createElement('div');
  body.id = `${id}-body`;
  applyStyles(body, {
    display: 'grid',
    gap: '10px',
  });

  let collapsed = false;
  collapseBtn.setAttribute('aria-controls', body.id);
  collapseBtn.setAttribute('aria-expanded', 'true');
  collapseBtn.addEventListener('click', (): void => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : 'grid';
    collapseBtn.textContent = collapsed ? '\u25B8' : '\u25BE';
    collapseBtn.title = collapsed ? 'Expand panel' : 'Collapse panel';
    collapseBtn.setAttribute('aria-label', collapseBtn.title);
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    panel.style.width = collapsed ? 'auto' : `${width}px`;
  });

  titleBar.append(titleEl, titleActions);
  panel.append(titleBar, body);
  doc.body.appendChild(panel);

  let didNotifyClose = false;
  const remove = (): boolean => {
    const removed = removeDebugPanel(id, doc);
    if (removed && !didNotifyClose) {
      didNotifyClose = true;
      options.onClose?.();
    }
    return removed;
  };
  closeBtn.addEventListener('click', remove);

  return {
    panel,
    body,
    remove,
  };
}
