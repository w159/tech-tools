// spark.ts (S1): the braille sparkline and the sub-cell gauge. Every output is exactly the requested width.
import { describe, expect, test } from 'claude-code/testing';
import { textWidth } from './theme';
import { GAUGE_STEPS, SPARK_RAMP, gauge, gaugeFramed, spark } from './spark';

const w = textWidth;

describe('spark', () => {
  test('the ramp is seven braille levels, lowest first', () => {
    expect(SPARK_RAMP).toBe('⣀⣄⣤⣦⣶⣷⣿');
  });
  test('0..max maps across the ramp: zero is the baseline, max the full cell', () => {
    expect(spark([0, 1, 2, 3, 4, 5, 6], 7, { max: 6 })).toBe('⣀⣄⣤⣦⣶⣷⣿');
  });
  test('a non-zero sample never draws as the baseline', () => {
    expect(spark([1, 100], 2)[0]).not.toBe('⣀');
  });
  test('an all-zero series is a flat baseline of the lowest glyph', () => {
    expect(spark(new Array(20).fill(0), 20)).toBe('⣀'.repeat(20));
    expect(spark([], 8)).toBe('⣀'.repeat(8));
  });
  test('a series longer than the width keeps the newest samples; a shorter one is padded on the left with the baseline', () => {
    expect(spark([6, 0, 0, 6], 2, { max: 6 })).toBe('⣀⣿');
    expect(spark([6], 3, { max: 6 })).toBe('⣀⣀⣿');
  });
  test('output width equals the requested width for every case', () => {
    for (const width of [0, 1, 8, 20, 28]) {
      for (const series of [[], [0, 0, 0], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], new Array(40).fill(3), [NaN, -4, 2]]) {
        expect(w(spark(series, width))).toBe(width);
      }
    }
  });
  test('ASCII fallback draws a same-width ramp without braille', () => {
    const a = spark([0, 3, 6], 3, { max: 6, ascii: true });
    expect(a.length).toBe(3);
    expect(/^[\x20-\x7e]+$/.test(a)).toBe(true);
  });
});

describe('gauge', () => {
  test('the steps are the eight sub-cell blocks', () => {
    expect(GAUGE_STEPS).toBe('▏▎▍▌▋▊▉█');
  });
  test('0% is all track, 100% all full', () => {
    expect(gauge(0, 10)).toBe('░'.repeat(10));
    expect(gauge(100, 10)).toBe('█'.repeat(10));
  });
  test('6% of 10 cells renders the right partial cell (4.8 eighths rounds to 5: ▋)', () => {
    expect(gauge(6, 10)).toBe('▋' + '░'.repeat(9));
  });
  test('50% of 10 cells is five full cells', () => {
    expect(gauge(50, 10)).toBe('█████' + '░'.repeat(5));
  });
  test('a non-zero reading never rounds to an empty gauge', () => {
    expect(gauge(0.1, 20)).toBe('▏' + '░'.repeat(19));
  });
  test('out-of-range and unreadable values clamp', () => {
    expect(gauge(150, 4)).toBe('████');
    expect(gauge(-5, 4)).toBe('░░░░');
    expect(gauge(NaN, 4)).toBe('░░░░');
  });
  test('framed adds the two end caps and keeps the inner width fixed', () => {
    expect(gaugeFramed(50, 10)).toBe('▕' + '█████░░░░░' + '▏');
  });
  test('output width equals the requested width for every case', () => {
    for (const width of [1, 6, 10, 20]) {
      for (const pct of [0, 0.4, 6, 33.3, 50, 99.9, 100]) {
        expect(w(gauge(pct, width))).toBe(width);
        expect(w(gaugeFramed(pct, width))).toBe(width + 2);
      }
    }
  });
  test('ASCII fallback is same-width printable ASCII', () => {
    const g = gauge(50, 10, true);
    expect(g.length).toBe(10);
    expect(/^[\x20-\x7e]+$/.test(g)).toBe(true);
  });
});
