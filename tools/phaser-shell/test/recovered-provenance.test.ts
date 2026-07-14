// Guards the committed recovered real-Editor provenance (card comments 55/56)
// against drift. The accepted P0/A/B chain was authored/published through the
// real desktop+unlocked Phaser Editor 5.0.2 on 2026-07-14; durable, scrubbed
// provenance recovered from that session's tool_result records is committed under
// `games/shell_proof_phaser/authoring/publications/`:
//   - recovered-provenance.json — index (accepted IDs + reduced P0/A + B pointer)
//   - provenance-b.full.json    — the complete u5.phaser.provenance/1 record for B
// These are read-only committed fixtures; this test is deterministic and offline
// (no Editor, no browser). It fails closed if the recovered record diverges from
// accepted.json, from the committed full-B file, or if a path/home leak sneaks in.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { repoPath, readJson } from './helpers.ts';
import { assertNoLeaks, type ProvenanceEvidence } from '../src/session/evidence.ts';

const PUBS = ['games', 'shell_proof_phaser', 'authoring', 'publications'];
const accepted = readJson(...PUBS, 'accepted.json') as {
  roles: Record<'p0' | 'a' | 'b', { publicationId: string }>;
};
const recovered = readJson(...PUBS, 'recovered-provenance.json') as {
  schema: string;
  acceptedPublications: Record<'p0' | 'a' | 'b', string>;
  acceptedValidation: { distinctIds: number; issues: unknown[]; matchesAcceptedJson: boolean };
  roles: Record<'p0' | 'a' | 'b', {
    evidenceClass: string;
    publish: { result: string; publicationId: string };
    launch: { result: string; deterministic?: boolean; endpointDown?: boolean; authStable?: boolean; genStable?: boolean };
    fullProvenance?: { file: string; sha256: string };
  }>;
};
const bFullBytes = readFileSync(repoPath(...PUBS, 'provenance-b.full.json'));
const bFull = JSON.parse(bFullBytes.toString('utf8')) as ProvenanceEvidence;

describe('recovered real-Editor provenance (P0/A/B)', () => {
  it('schema is the recovered-provenance envelope', () => {
    expect(recovered.schema).toBe('u5.phaser.recovered-provenance/1');
  });

  it('every recorded publicationId is byte-identical to accepted.json, and A != B', () => {
    for (const role of ['p0', 'a', 'b'] as const) {
      expect(recovered.acceptedPublications[role]).toBe(accepted.roles[role].publicationId);
      expect(recovered.roles[role].publish.publicationId).toBe(accepted.roles[role].publicationId);
      expect(recovered.roles[role].publish.result).toBe('ok');
      expect(recovered.roles[role].launch.result).toBe('ok');
    }
    expect(new Set(Object.values(recovered.acceptedPublications)).size).toBe(3);
    expect(accepted.roles.a.publicationId).not.toBe(accepted.roles.b.publicationId);
  });

  it('the recorded accepted-validation summary is clean and self-consistent', () => {
    expect(recovered.acceptedValidation.matchesAcceptedJson).toBe(true);
    expect(recovered.acceptedValidation.distinctIds).toBe(3);
    expect(recovered.acceptedValidation.issues).toEqual([]);
  });

  it('P0/A are reduced tool-output; B is full hash-rich', () => {
    expect(recovered.roles.p0.evidenceClass).toBe('reduced-tool-output');
    expect(recovered.roles.a.evidenceClass).toBe('reduced-tool-output');
    expect(recovered.roles.b.evidenceClass).toBe('full-hash-rich');
    for (const role of ['p0', 'a', 'b'] as const) {
      const l = recovered.roles[role].launch;
      expect([l.deterministic, l.endpointDown, l.authStable, l.genStable]).toEqual([true, true, true, true]);
    }
  });

  it('provenance-b.full.json is byte-verifiable against the committed sha256 pointer', () => {
    const sha = 'sha256-' + createHash('sha256').update(bFullBytes).digest('hex');
    expect(recovered.roles.b.fullProvenance?.file).toBe('provenance-b.full.json');
    expect(sha).toBe(recovered.roles.b.fullProvenance?.sha256);
  });

  it('the full B record is an ok, deterministic, restart-stable u5.phaser.provenance/1 record', () => {
    expect(bFull.schema).toBe('u5.phaser.provenance/1');
    expect(bFull.result).toBe('ok');
    expect(bFull.serverMode).toEqual({ desktop: true, unlocked: true });
    expect(bFull.compile.deterministic).toBe(true);
    expect(bFull.compile.generation1?.combined).toBe(bFull.compile.generation2?.combined);
    expect(bFull.authority.stableAcrossRestart).toBe(true);
    expect(bFull.generated.stableAcrossRestart).toBe(true);
    expect(bFull.restart.endpointDownProven).toBe(true);
    expect(bFull.sceneOrder).toEqual(['Menu', 'Level', 'Shop', 'Settings', 'Pause', 'Win', 'Fail']);
  });

  it('neither committed record leaks an absolute or home path', () => {
    expect(() => assertNoLeaks(recovered)).not.toThrow();
    expect(() => assertNoLeaks(bFull)).not.toThrow();
  });
});
