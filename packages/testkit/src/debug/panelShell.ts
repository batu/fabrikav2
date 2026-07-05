export interface DebugPanelShellOptions {
  id: string;
  title: string;
  width?: number;
  document?: Document;
}

export interface DebugPanelShell {
  panel: HTMLElement;
  body: HTMLDivElement;
  remove(): boolean;
}

function applyStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
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
  collapseBtn.setAttribute(
    'style',
    'background:none;border:1px solid rgba(157,208,255,0.3);color:#e0eaff;cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px;line-height:1',
  );

  const body = doc.createElement('div');
  applyStyles(body, {
    display: 'grid',
    gap: '10px',
  });

  let collapsed = false;
  collapseBtn.addEventListener('click', (): void => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : 'grid';
    collapseBtn.textContent = collapsed ? '\u25B8' : '\u25BE';
    panel.style.width = collapsed ? 'auto' : `${width}px`;
  });

  titleBar.append(titleEl, collapseBtn);
  panel.append(titleBar, body);
  doc.body.appendChild(panel);

  return {
    panel,
    body,
    remove: (): boolean => removeDebugPanel(id, doc),
  };
}
