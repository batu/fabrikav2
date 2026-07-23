import React from 'react';
import { createRoot } from 'react-dom/client';
import JobStatusBadge from '../src/components/JobStatusBadge';

function Harness() {
  return (
    <main>
      <section data-testid="generating-active">
        <JobStatusBadge state="generating_bg" backendActive={true} lastCheckedAt={0} />
      </section>
      <section data-testid="generating-inactive">
        <JobStatusBadge state="generating_bg" backendActive={false} lastCheckedAt={0} />
      </section>
      <section data-testid="upscaling">
        <JobStatusBadge
          state="upscaling_bg"
          upscaleJobId="job-123"
          upscaleJobStatus="running"
          upscaleJobRawStatus="polling"
          lastCheckedAt={0}
        />
      </section>
      <section data-testid="failed">
        <JobStatusBadge
          state="failed"
          upscaleJobId="job-456"
          upscaleJobStatus="failed"
          upscaleJobRawStatus="orphaned_unknown"
          upscaleJobRetryable={false}
          upscaleJobErrorCode="orphaned_unknown"
          lastCheckedAt={1_700_000_000_000}
        />
      </section>
      <section data-testid="null-render">
        <JobStatusBadge state="awaiting_tweak" />
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
