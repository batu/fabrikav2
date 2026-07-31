import { requestFtd, type JobsTransportOptions } from '../../api/http.ts';
import type {
  PresetIndexResponse,
  PresetRecord,
  PresetRunRecord,
  PresetSelection,
  ResolvedPreset,
} from '../../api/generated.ts';

export function createPresetsApi(options: JobsTransportOptions) {
  const request = <T>(method: 'GET' | 'POST', path: string, body?: unknown) =>
    requestFtd<T>(options, method, path, body);

  return {
    index(): Promise<PresetIndexResponse> {
      return request<PresetIndexResponse>('GET', '/api/presets');
    },
    resolve(presetId: string): Promise<ResolvedPreset> {
      return request<ResolvedPreset>('GET', `/api/presets/${encodeURIComponent(presetId)}/resolved`);
    },
    updateSelection(presetId: string, selection: PresetSelection): Promise<PresetRecord> {
      return request<PresetRecord>(
        'POST',
        `/api/presets/${encodeURIComponent(presetId)}/selection`,
        { selection },
      );
    },
    recordRun(presetId: string, runId: string, note = ''): Promise<PresetRunRecord> {
      return request<PresetRunRecord>(
        'POST',
        `/api/presets/${encodeURIComponent(presetId)}/runs`,
        { runId, outcome: 'recorded', note },
      );
    },
    runs(): Promise<PresetRunRecord[]> {
      return request<PresetRunRecord[]>('GET', '/api/presets/runs');
    },
  };
}

export type PresetsApi = ReturnType<typeof createPresetsApi>;
