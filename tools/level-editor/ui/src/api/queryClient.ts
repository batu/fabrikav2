import { QueryClient } from '@tanstack/react-query';

/**
 * Single app-wide QueryClient — the cache-of-server-truth shell (plan -001 A2,
 * spec -003).
 *
 * Freshness is driven by EXPLICIT `invalidateQueries` after mutations, never by
 * background refetch: `staleTime: Infinity` + `refetchOnWindowFocus: false`. This
 * is load-bearing during the A2 strangler overlap — the god-reducer remains the
 * render source of truth, and an unexpected background refetch could otherwise
 * race the reducer / the SSE streams and surface stale or conflicting state.
 * `retry: false` keeps the editor's existing fail-fast error surface.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});
