import { describe, it, expect } from 'vitest';
import {
  evaluateViewportMetricAssertions,
  formatViewportMetricAssertions,
  parseViewportMetricsLabel,
  resolveViewportMetricRanges,
  stateFromViewportMetricsAttachmentName,
  summarizeViewportMetricAssertions,
  viewportMetricAssertionsPass,
} from '../src/viewportMetrics.mjs';

describe('viewport metrics parsing', () => {
  it('parses the marker label published by the in-situ tour', () => {
    const parsed = parseViewportMetricsLabel(
      'viewportmetrics:state=tourstate:menu;inner=390x844;vv=390x800@1;screen=393x852;safe=59,0,34,0;canvas=390x844/780x1688;dpr=3'
    );

    expect(parsed).toEqual({
      markerState: 'tourstate:menu',
      windowInnerWidth: 390,
      windowInnerHeight: 844,
      visualViewportWidth: 390,
      visualViewportHeight: 800,
      visualViewportScale: 1,
      screenWidth: 393,
      screenHeight: 852,
      safeAreaInsetTop: 59,
      safeAreaInsetRight: 0,
      safeAreaInsetBottom: 34,
      safeAreaInsetLeft: 0,
      canvasCssWidth: 390,
      canvasCssHeight: 844,
      canvasBackingWidth: 780,
      canvasBackingHeight: 1688,
      devicePixelRatio: 3,
    });
  });

  it('maps runner viewport-metrics attachment names back to manifest states', () => {
    const states = ['menu', 'fail', 'shop', 'level_intro'];
    expect(stateFromViewportMetricsAttachmentName('1-menu-viewportmetrics_0_uuid.txt', states)).toBe('menu');
    expect(stateFromViewportMetricsAttachmentName('6-fail-viewportmetrics-MISSING_0_uuid.txt', states)).toBe('fail');
    expect(stateFromViewportMetricsAttachmentName('2-shop-viewportmetrics_0_uuid.txt', states)).toBe('shop');
    expect(stateFromViewportMetricsAttachmentName('3-level_intro-viewportmetrics_0_uuid.txt', states)).toBe('level_intro');
    expect(stateFromViewportMetricsAttachmentName('7-final-viewportmetrics_0_uuid.txt', states)).toBeNull();
  });
});

describe('viewport metric assertions', () => {
  const manifest = {
    states: [{ name: 'menu' }, { name: 'level' }],
    verifyDevice: {
      viewportMetrics: {
        ranges: [
          { metric: 'windowInnerHeight', min: 800, max: 900 },
          { metric: 'safeAreaInsetTop', min: 40, states: ['menu'] },
        ],
      },
    },
  };

  it('normalizes manifest ranges and defaults unstated states to all manifest states', () => {
    expect(resolveViewportMetricRanges(manifest)).toEqual([
      {
        metric: 'windowInnerHeight',
        min: 800,
        max: 900,
        states: ['menu', 'level'],
        label: 'windowInnerHeight',
      },
      {
        metric: 'safeAreaInsetTop',
        min: 40,
        max: null,
        states: ['menu'],
        label: 'safeAreaInsetTop',
      },
    ]);
  });

  it('evaluates pass, fail, and missing assertion statuses', () => {
    const assertions = evaluateViewportMetricAssertions({
      manifest,
      metricsByState: {
        menu: { windowInnerHeight: 844, safeAreaInsetTop: 59 },
        level: { windowInnerHeight: 700 },
      },
    });

    expect(assertions).toEqual([
      expect.objectContaining({ state: 'menu', metric: 'windowInnerHeight', status: 'pass', value: 844 }),
      expect.objectContaining({ state: 'level', metric: 'windowInnerHeight', status: 'fail', value: 700 }),
      expect.objectContaining({ state: 'menu', metric: 'safeAreaInsetTop', status: 'pass', value: 59 }),
    ]);
    expect(viewportMetricAssertionsPass(assertions)).toBe(false);
    expect(summarizeViewportMetricAssertions(assertions)).toBe('FAIL — 2 pass, 1 fail');
    expect(formatViewportMetricAssertions(assertions)).toContain('viewport-metrics assertions');
  });

  it('marks configured metrics as missing when a state publishes no metric value', () => {
    const assertions = evaluateViewportMetricAssertions({ manifest, metricsByState: { menu: {} } });

    expect(assertions.find((a) => a.state === 'level')).toMatchObject({
      metric: 'windowInnerHeight',
      status: 'missing',
      value: null,
    });
  });
});
