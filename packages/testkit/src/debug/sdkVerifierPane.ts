import { mountDebugPanel, removeDebugPanel } from './panelShell.ts';

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
}

export interface SdkVerifierPane {
  remove: () => boolean;
  /** External callback feed (provider listeners push here). */
  log: (source: string, message: string) => void;
  /** Re-reads every entry's getStatus() into the DOM. */
  refreshStatuses: () => void;
}

const DEFAULT_ID = 'sdk-verifier-pane';
const DEFAULT_MAX_LOG_ENTRIES = 200;

export function removeSdkVerifierPane(doc: Document = document): boolean {
  return removeDebugPanel(DEFAULT_ID, doc);
}

export function mountSdkVerifierPane(options: SdkVerifierPaneOptions): SdkVerifierPane {
  const doc = options.document ?? document;
  const now = options.now ?? ((): Date => new Date());
  const maxLogEntries = options.maxLogEntries ?? DEFAULT_MAX_LOG_ENTRIES;
  const shell = mountDebugPanel({
    id: options.id ?? DEFAULT_ID,
    title: options.title ?? 'SDK Verifier',
    width: 300,
    document: doc,
  });

  const statusElements = new Map<string, HTMLElement>();

  for (const entry of options.entries) {
    const section = doc.createElement('section');
    section.dataset.sdk = entry.name;

    const heading = doc.createElement('strong');
    heading.textContent = entry.name;
    section.appendChild(heading);

    const status = doc.createElement('div');
    status.dataset.role = 'status';
    status.textContent = entry.getStatus();
    statusElements.set(entry.name, status);
    section.appendChild(status);

    for (const [key, value] of Object.entries(entry.configuredIds)) {
      const idRow = doc.createElement('div');
      idRow.dataset.role = 'configured-id';
      idRow.textContent = `${key}: ${value ?? '(not set)'}`;
      section.appendChild(idRow);
    }

    for (const action of entry.actions) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = action.label;
      button.addEventListener('click', (): void => {
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
            refreshStatuses();
          });
      });
      section.appendChild(button);
    }

    shell.body.appendChild(section);
  }

  const logList = doc.createElement('ol');
  logList.dataset.role = 'callback-log';
  shell.body.appendChild(logList);

  function log(source: string, message: string): void {
    const item = doc.createElement('li');
    item.textContent = `${formatTime(now())} [${source}] ${message}`;
    logList.appendChild(item);
    while (logList.children.length > maxLogEntries) {
      logList.removeChild(logList.children[0]);
    }
  }

  function refreshStatuses(): void {
    for (const entry of options.entries) {
      const element = statusElements.get(entry.name);
      if (element !== undefined) {
        element.textContent = entry.getStatus();
      }
    }
  }

  return {
    remove: shell.remove,
    log,
    refreshStatuses,
  };
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
