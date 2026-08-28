import { mountSdkVerifierPane, removeSdkVerifierPane, type SdkVerifierPane } from '@fabrikav2/testkit/debug';
import { forceCrashForVerification, readCrashlyticsState, sendUnsentCrashReports } from '@fabrikav2/sdk/crashlytics-probe';

const loader = () => import('@capacitor-firebase/crashlytics');
let mounted: SdkVerifierPane | null = null;

export function toggleSdkVerifierPane(doc: Document = document): boolean {
  if (mounted !== null) { mounted.remove(); mounted = null; removeSdkVerifierPane(doc); return false; }
  mounted = mountSdkVerifierPane({
    document: doc,
    entries: [{
      name: 'firebase crashlytics',
      configuredIds: { analytics: 'disabled', crashlytics: 'enabled' },
      getStatus: (): string => 'test-only probe ready',
      actions: [
        { label: 'Read state', run: async () => JSON.stringify(await readCrashlyticsState(loader)) },
        { label: 'Send unsent reports', run: async () => { await sendUnsentCrashReports(loader); return 'queued'; } },
        { label: 'FORCE CRASH (kills app)', run: async () => { const marker = `find_bird_verifier_${new Date().toISOString()}`; await forceCrashForVerification(loader, true, marker); return marker; } },
      ],
    }],
    onClose: () => { mounted = null; },
  });
  return true;
}

export async function runControlledCrash(marker: string): Promise<void> {
  await forceCrashForVerification(loader, true, marker);
}
