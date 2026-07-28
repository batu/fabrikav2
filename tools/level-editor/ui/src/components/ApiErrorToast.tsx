import { useEffect, useState } from 'react';
import { API_ERROR_EVENT, type ApiError } from '../api/editorApi';

// Extends the global WindowEventMap so addEventListener('ftd:api-error', …)
// receives a properly-typed CustomEvent<ApiError> event. Pre-fix, the
// handler had to cast `e as CustomEvent<ApiError>` manually, and a typo
// in the event name would silently register against the untyped string
// overload.
declare global {
  interface WindowEventMap {
    [API_ERROR_EVENT]: CustomEvent<ApiError>;
  }
}

type Toast = {
  id: string;
  status: number;
  method: string;
  url: string;
  message: string;
  detail: string;
};

/** Listens for ftd:api-error events dispatched from editorApi.request()
 * and renders a dismissible toast per failure. Without this, every API
 * error became an `Uncaught (in promise) ApiError` in devtools with no
 * user-visible signal — the UI just sat there spinning.
 *
 * Hoisted to a single App-root instance so tab navigation doesn't
 * remount a fresh listener each time — see App.tsx for the wrapper.
 */
export default function ApiErrorToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    // Detail rendering gate: in production builds (e.g. a Cloudflare-
    // tunneled operator-facing URL shared with a non-operator helper),
    // upstream stack traces + absolute filesystem paths in err.detail
    // leak backend layout. Cap to empty string outside dev. Gate on
    // MODE !== 'production' (not DEV) because DEV is dev-server-only
    // and evaluates false in preview / non-local builds.
    type ViteEnv = { MODE?: string };
    const _mode = (import.meta as unknown as { env?: ViteEnv }).env?.MODE;
    const isProd = _mode === 'production';

    function onErr(e: WindowEventMap[typeof API_ERROR_EVENT]) {
      const err = e.detail;
      if (!err) return;
      const rawDetail = err.detail
        ? typeof err.detail === 'string'
          ? err.detail
          : JSON.stringify(err.detail).slice(0, 300)
        : '';
      const detailText = isProd ? '' : rawDetail;
      setToasts((cur) => [
        ...cur,
        {
          // crypto.randomUUID replaces a module-level `let nextId` that
          // could collide across hot-reload cycles or multiple instances.
          id: crypto.randomUUID(),
          status: err.status,
          method: err.method,
          url: err.url,
          message: err.message,
          detail: detailText,
        },
      ]);
    }
    window.addEventListener(API_ERROR_EVENT, onErr);
    return () => window.removeEventListener(API_ERROR_EVENT, onErr);
  }, []);

  function dismiss(id: string) {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 480,
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            background: '#2b1a1a',
            color: '#ffd9d9',
            border: '1px solid #c54040',
            borderRadius: 6,
            padding: '10px 12px',
            fontSize: 13,
            fontFamily: 'ui-monospace, monospace',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <strong>{t.message}</strong>
            <button
              onClick={() => dismiss(t.id)}
              style={{
                background: 'transparent',
                color: '#ffd9d9',
                border: 'none',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: 0,
              }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
          <div style={{ opacity: 0.8, marginTop: 4, wordBreak: 'break-all' }}>
            {t.method} {t.url}
          </div>
          {t.detail && (
            <div style={{ opacity: 0.7, marginTop: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {t.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
