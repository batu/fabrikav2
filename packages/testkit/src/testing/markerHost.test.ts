// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';

import { ensureHostedMarker } from './markerHost.ts';
import { ensureTourMarker, publishTourMarker, TOUR_MARKER_ID } from './tourMarker.ts';

describe('ensureHostedMarker', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('creates the marker once under body and reuses it', () => {
    const first = ensureHostedMarker('__probe__');
    const second = ensureHostedMarker('__probe__');
    expect(second).toBe(first);
    expect(first.parentElement).toBe(document.body);
    expect(first.getAttribute('role')).toBe('text');
  });

  it('re-parents the marker into an open aria-modal dialog', () => {
    const marker = ensureHostedMarker('__probe__');
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);

    expect(ensureHostedMarker('__probe__')).toBe(marker);
    expect(marker.parentElement).toBe(modal);
  });

  it('returns the marker to body after the modal is removed, recreating if needed', () => {
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);
    ensureHostedMarker('__probe__');
    modal.remove();

    const marker = ensureHostedMarker('__probe__');
    expect(marker.parentElement).toBe(document.body);
    expect(document.getElementById('__probe__')).toBe(marker);
  });

  it('keeps published tourstate labels visible inside a modal host', () => {
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    document.body.appendChild(modal);

    const marker = publishTourMarker('fail', { publishMetrics: false });
    expect(marker).toBe(ensureTourMarker());
    expect(marker.parentElement).toBe(modal);
    expect(marker.getAttribute('aria-label')).toBe('tourstate:fail');
    expect(document.getElementById(TOUR_MARKER_ID)).toBe(marker);
  });
});
