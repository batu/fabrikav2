import { applyStyles, mountDebugPanel, removeDebugPanel } from './panelShell.ts';

/**
 * SDK verifier pane — a TOOL, not an agent: it exposes per-SDK status, one-shot
 * action buttons, and a callback log, and every interaction returns immediately.
 * It never loops, retries, or self-directs; the human (or driving agent) owns
 * the loop. Generic against descriptors so any game can mount it.
 */

export interface SdkVerifierAction {
  label: string;
  /** One call per press. The pane logs start/result/error; it never retries. */
  run: () => Promise<string | void>;
}

export interface SdkVerifierEntry {
  name: string;
  /** Non-secret configured identity (app ids, unit ids) — shown verbatim. */
  configuredIds: Record<string, string | null>;
  /** Live status text, re-read on every render (e.g. 'initialized', 'not configured: …'). */
  getStatus: () => string;
  actions: SdkVerifierAction[];
}

export interface SdkVerifierPaneOptions {
  id?: string;
  title?: string;
  entries: SdkVerifierEntry[];
  document?: Document;
  now?: () => Date;
  maxLogEntries?: number;
  onClose?: () => void;
}

export interface SdkVerifierPane {
  remove: () => boolean;
  /** External callback feed (provider listeners push here). */
  log: (source: string, message: string) => void;
  /** Re-reads every entry's getStatus() into the DOM. */
  refreshStatuses: () => void;
}

export const SDK_VERIFIER_PANEL_ID = 'sdk-verifier-pane';
const DEFAULT_MAX_LOG_ENTRIES = 200;

export function removeSdkVerifierPane(doc: Document = document): boolean {
  return removeDebugPanel(SDK_VERIFIER_PANEL_ID, doc);
}

export function mountSdkVerifierPane(options: SdkVerifierPaneOptions): SdkVerifierPane {
  const doc = options.document ?? document;
  const now = options.now ?? ((): Date => new Date());
  const maxLogEntries = options.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES;
  const shell = mountDebugPanel({
    id: options.id ?? SDK_VERIFIER_PANEL_ID,
    title: options.title ?? 'SDK Verifier',
    width: 380,
    document: doc,
    onClose: options.onClose,
  });
  applyStyles(shell.panel, {
    top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
    right: 'calc(env(safe-area-inset-right, 0px) + 12px)',
    maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 16px)',
    padding: '14px',
    borderRadius: '16px',
    background: 'rgba(8, 14, 30, 0.97)',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.45)',
  });

  const statusElements = new Map<SdkVerifierEntry, HTMLElement>();

  const intro = doc.createElement('div');
  intro.dataset.role = 'verifier-summary';
  intro.textContent = `${options.entries.length} integrations · Tap an action once, then check the activity log.`;
  applyStyles(intro, {
    color: '#a8b8d8',
    fontSize: '12px',
    lineHeight: '1.4',
  });
  shell.body.appendChild(intro);

  const refreshButton = doc.createElement('button');
  refreshButton.type = 'button';
  refreshButton.dataset.action = 'refresh-statuses';
  refreshButton.textContent = 'Refresh statuses';
  styleButton(refreshButton, 'secondary');
  refreshButton.addEventListener('click', (): void => refreshStatuses());
  shell.body.appendChild(refreshButton);

  for (const entry of options.entries) {
    const section = doc.createElement('section');
    section.dataset.sdk = entry.name;
    applyStyles(section, {
      display: 'grid',
      gap: '10px',
      padding: '12px',
      borderRadius: '12px',
      background: 'rgba(255, 255, 255, 0.055)',
      border: '1px solid rgba(148, 181, 232, 0.16)',
    });

    const heading = doc.createElement('strong');
    heading.textContent = entry.name;
    applyStyles(heading, {
      fontSize: '14px',
      textTransform: 'capitalize',
    });
    section.appendChild(heading);

    const status = doc.createElement('div');
    status.dataset.role = 'status';
    status.textContent = entry.getStatus();
    applyStyles(status, {
      padding: '7px 9px',
      borderRadius: '8px',
      background: 'rgba(96, 165, 250, 0.12)',
      color: '#bfdbfe',
      fontSize: '12px',
      lineHeight: '1.35',
      overflowWrap: 'anywhere',
    });
    statusElements.set(entry, status);
    section.appendChild(status);

    const configured = doc.createElement('details');
    const configuredSummary = doc.createElement('summary');
    configuredSummary.textContent = 'Configuration';
    applyStyles(configuredSummary, {
      cursor: 'pointer',
      color: '#cbd5e1',
      fontSize: '12px',
      fontWeight: '700',
      minHeight: '32px',
      lineHeight: '32px',
    });
    configured.appendChild(configuredSummary);
    for (const [key, value] of Object.entries(entry.configuredIds)) {
      const idRow = doc.createElement('div');
      idRow.dataset.role = 'configured-id';
      idRow.textContent = `${key}: ${value ?? '(not set)'}`;
      applyStyles(idRow, {
        color: '#94a3b8',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11px',
        lineHeight: '1.45',
        overflowWrap: 'anywhere',
      });
      configured.appendChild(idRow);
    }
    section.appendChild(configured);

    const actions = doc.createElement('div');
    actions.dataset.role = 'sdk-actions';
    applyStyles(actions, {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(132px, 1fr))',
      gap: '8px',
    });
    for (const action of entry.actions) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      styleButton(button, 'primary');
      button.addEventListener('click', (): void => {
        if (button.disabled) return;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.textContent = 'Working…';
        log(entry.name, `${action.label}…`);
        void action
          .run()
          .then((result): void => {
            log(entry.name, `${action.label}: ${result ?? 'done'}`);
          })
          .catch((err: unknown): void => {
            log(entry.name, `${action.label} FAILED: ${describeError(err)}`);
          })
          .finally((): void => {
            button.disabled = false;
            button.setAttribute('aria-busy', 'false');
            button.textContent = action.label;
            refreshStatus(entry);
          });
      });
      actions.appendChild(button);
    }
    section.appendChild(actions);

    shell.body.appendChild(section);
  }

  const logHeading = doc.createElement('strong');
  logHeading.textContent = 'Activity log';
  applyStyles(logHeading, {
    marginTop: '2px',
    fontSize: '13px',
  });
  shell.body.appendChild(logHeading);

  const emptyLog = doc.createElement('div');
  emptyLog.dataset.role = 'callback-log-empty';
  emptyLog.textContent = 'Actions and callbacks will appear here.';
  applyStyles(emptyLog, {
    color: '#7f8da8',
    fontSize: '12px',
  });
  shell.body.appendChild(emptyLog);

  const logList = doc.createElement('ol');
  logList.dataset.role = 'callback-log';
  logList.setAttribute('role', 'status');
  logList.setAttribute('aria-live', 'polite');
  logList.setAttribute('aria-relevant', 'additions');
  applyStyles(logList, {
    display: 'grid',
    gap: '6px',
    margin: '0',
    padding: '0 0 0 22px',
    color: '#cbd5e1',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '11px',
    lineHeight: '1.45',
  });
  shell.body.appendChild(logList);

  function log(source: string, message: string): void {
    emptyLog.remove();
    const item = doc.createElement('li');
    item.textContent = `${formatTime(now())} [${source}] ${message}`;
    if (message.includes(' FAILED:')) item.setAttribute('role', 'alert');
    logList.appendChild(item);
    while (logList.children.length > maxLogEntries) {
      logList.removeChild(logList.children[0]);
    }
  }

  function refreshStatuses(): void {
    for (const entry of options.entries) {
      refreshStatus(entry);
    }
  }

  function refreshStatus(entry: SdkVerifierEntry): void {
    const element = statusElements.get(entry);
    if (element === undefined) return;
    const nextStatus = entry.getStatus();
    if (element.textContent !== nextStatus) element.textContent = nextStatus;
  }

  return {
    remove: shell.remove,
    log,
    refreshStatuses,
  };
}

function styleButton(button: HTMLButtonElement, variant: 'primary' | 'secondary'): void {
  applyStyles(button, {
    minHeight: '44px',
    padding: '9px 12px',
    borderRadius: '10px',
    border: variant === 'primary'
      ? '1px solid rgba(96, 165, 250, 0.45)'
      : '1px solid rgba(148, 163, 184, 0.28)',
    background: variant === 'primary'
      ? 'linear-gradient(180deg, rgba(59, 130, 246, 0.34), rgba(37, 99, 235, 0.22))'
      : 'rgba(255, 255, 255, 0.06)',
    color: '#eff6ff',
    fontFamily: 'inherit',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
  });
}

function formatTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
