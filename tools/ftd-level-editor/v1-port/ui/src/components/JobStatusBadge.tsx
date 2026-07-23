type BatchJobStatusState =
  | 'queued'
  | 'generating_bg'
  | 'bg_ready'
  | 'upscaling_bg'
  | 'placing_auto'
  | 'awaiting_tweak'
  | 'inpainting'
  | 'inpainted'
  | 'exported'
  | 'failed';
type UpscaleJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

interface JobStatusBadgeProps {
  state: BatchJobStatusState;
  backendActive?: boolean;
  lastCheckedAt?: number;
  upscaleJobId?: string;
  upscaleJobStatus?: UpscaleJobStatus;
  upscaleJobRawStatus?: string;
  upscaleJobRetryable?: boolean;
  upscaleJobErrorCode?: string | null;
}

export default function JobStatusBadge({
  state,
  backendActive,
  lastCheckedAt,
  upscaleJobId,
  upscaleJobStatus,
  upscaleJobRawStatus,
  upscaleJobRetryable,
  upscaleJobErrorCode,
}: JobStatusBadgeProps) {
  const checkedLabel = lastCheckedAt
    ? new Date(lastCheckedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'not checked yet';
  const lines: string[] = [];

  if (state === 'generating_bg') {
    lines.push(backendActive ? 'backend: background stream active (keep tab connected)' : 'backend: no active background stream');
  }
  if (state === 'upscaling_bg') {
    lines.push(`durable upscale job: ${upscaleJobRawStatus ?? upscaleJobStatus ?? 'checking'}${upscaleJobId ? ` (${upscaleJobId})` : ''}`);
    lines.push('safe to close this tab during upscale');
  }
  if (state === 'failed' && upscaleJobRawStatus) {
    lines.push(`durable upscale job: ${upscaleJobRawStatus}${upscaleJobRetryable === false ? ' (manual review)' : ''}`);
    if (upscaleJobErrorCode) lines.push(`error code: ${upscaleJobErrorCode}`);
  }
  if (state === 'failed' && lastCheckedAt) {
    lines.push('backend: stopped');
  }

  if (lines.length === 0 && !lastCheckedAt) return null;

  return (
    <div role="status" data-testid="job-status-badge" data-upscale-job-id={upscaleJobId ?? ''} data-upscale-job-status={upscaleJobRawStatus ?? upscaleJobStatus ?? ''} style={{ fontSize: '0.72rem', color: '#777', marginTop: 4, lineHeight: 1.35 }}>
      {lines.map((line) => <div key={line}>{line}</div>)}
      <div>checked: {checkedLabel}</div>
    </div>
  );
}
