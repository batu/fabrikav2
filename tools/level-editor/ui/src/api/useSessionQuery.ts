import { useQuery } from '@tanstack/react-query';

import { getSession } from './editorApi';
import type { SessionResponse } from '../types';

/** Canonical query key for a session's server truth. */
export const sessionQueryKey = (sessionId: string | null | undefined) =>
  ['session', sessionId] as const;

/**
 * The `['session', id]` cache-of-server-truth query (plan -001 A2, spec -003).
 *
 * STRANGLER NOTE: DogsCanvas (B2) is the render consumer; the wizard still
 * renders from the god-reducer and does NOT populate or invalidate this cache
 * (an earlier comment claimed App routed loads through queryClient.fetchQuery
 * — that was never implemented; ledger 054 #38). Cross-store freshness is
 * instead guaranteed by refetchOnMount: 'always' below. The remaining reducer
 * fields migrate here as part of the C/D collapse, and the reducer dies in E1.
 */
export function useSessionQuery(sessionId: string | null | undefined) {
  return useQuery<SessionResponse>({
    queryKey: sessionQueryKey(sessionId),
    queryFn: () => getSession(sessionId as string),
    enabled: !!sessionId,
    // ALWAYS re-sync from the server when a consumer (re)mounts. With
    // staleTime: Infinity and invalidation only from DogsCanvas's own
    // mutations, the cache went permanently stale whenever the WIZARD (the
    // strangler twin store) mutated the same session server-side — and
    // DogsCanvas's next full-array debounced save then pushed that stale
    // snapshot back, silently clobbering the wizard's newer server state
    // (fresh-review P1 — ledger 054 #4). The wizard can't mutate while the
    // Dogs tab is mounted, so syncing at mount closes the reachable path.
    refetchOnMount: 'always',
  });
}
