/**
 * Tests for audio.js pure utility algorithms.
 *
 * Note: AudioAnalyser itself requires a browser AudioContext and MediaDevices,
 * so we can't instantiate it in Node. These tests cover the extractable math:
 * RMS calculation and the HUP burst detection window logic.
 *
 * TODO: If the audio analysis logic grows more complex, extract the pure
 * algorithmic parts into separate functions in audio-utils.js and test those.
 * Keep AudioAnalyser as the integration wrapper.
 */

import { describe, it, expect } from 'vitest';

// ── RMS calculation (inline — mirrors what audio.js does) ────────────────────

function calcRMS(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}

describe('RMS calculation', () => {
  it('returns 0 for silent buffer', () => {
    const buf = new Float32Array(1024).fill(0);
    expect(calcRMS(buf)).toBe(0);
  });

  it('returns correct RMS for a constant signal', () => {
    const buf = new Float32Array(1024).fill(0.5);
    expect(calcRMS(buf)).toBeCloseTo(0.5);
  });

  it('returns 1/√2 ≈ 0.707 for a full-amplitude sine wave', () => {
    const buf = new Float32Array(1024);
    for (let i = 0; i < buf.length; i++) buf[i] = Math.sin((2 * Math.PI * i) / 64);
    expect(calcRMS(buf)).toBeCloseTo(0.707, 2);
  });

  it('always returns a non-negative value', () => {
    const buf = new Float32Array(512);
    for (let i = 0; i < buf.length; i++) buf[i] = (Math.random() - 0.5) * 2;
    expect(calcRMS(buf)).toBeGreaterThanOrEqual(0);
  });
});

// ── HUP burst detection logic (extracted from audio.js for testing) ──────────

const HUP_RISE = 0.4;
const HUP_FALL = 0.15;
const HUP_MAX_MS = 200;
const HUP_COOLDOWN = 150;

/**
 * Simulate the HUP burst detector over a sequence of (volume, timestamp) pairs.
 * Returns array of timestamps where a HUP would be detected.
 */
function simulateHupDetector(frames) {
  let rising = false;
  let riseTime = 0;
  let lastHup = -999;
  const detected = [];

  for (const { vol, t } of frames) {
    if (vol >= HUP_RISE && !rising) {
      rising = true;
      riseTime = t;
    }
    if (rising) {
      const elapsed = t - riseTime;
      if (vol < HUP_FALL) {
        if (elapsed <= HUP_MAX_MS && t - lastHup > HUP_COOLDOWN) {
          detected.push(t);
          lastHup = t;
        }
        rising = false;
      } else if (elapsed > HUP_MAX_MS) {
        rising = false; // sustained — not a HUP
      }
    }
  }
  return detected;
}

describe('HUP burst detection', () => {
  it('detects a clean HUP burst (spike then quick fall)', () => {
    const frames = [
      { vol: 0.1, t: 0 },
      { vol: 0.1, t: 16 },
      { vol: 0.5, t: 32 },  // spike
      { vol: 0.6, t: 48 },
      { vol: 0.1, t: 80 },  // drops back below fall threshold — HUP!
      { vol: 0.1, t: 96 },
    ];
    expect(simulateHupDetector(frames)).toHaveLength(1);
    expect(simulateHupDetector(frames)[0]).toBe(80);
  });

  it('does NOT detect a sustained scream as HUP', () => {
    const frames = [];
    // Volume stays high for 300ms — too long for HUP_MAX_MS (200ms)
    for (let t = 0; t <= 300; t += 16) {
      frames.push({ vol: t < 16 ? 0.1 : 0.7, t });
    }
    expect(simulateHupDetector(frames)).toHaveLength(0);
  });

  it('does NOT detect a quiet sound as HUP (below rise threshold)', () => {
    const frames = [
      { vol: 0.1, t: 0 },
      { vol: 0.3, t: 16 }, // below 0.4 threshold
      { vol: 0.1, t: 32 },
    ];
    expect(simulateHupDetector(frames)).toHaveLength(0);
  });

  it('respects cooldown — does not double-fire within cooldown window', () => {
    const frames = [
      { vol: 0.5, t: 0 },
      { vol: 0.1, t: 50 },  // first HUP at t=50
      { vol: 0.5, t: 100 },
      { vol: 0.1, t: 150 }, // only 100ms since last — within cooldown (150ms)
      { vol: 0.5, t: 300 },
      { vol: 0.1, t: 350 }, // 200ms since last — outside cooldown, should fire
    ];
    const hits = simulateHupDetector(frames);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toBe(50);
    expect(hits[1]).toBe(350);
  });

  it('detects multiple separate HUPs with gap between them', () => {
    const frames = [
      { vol: 0.5, t: 0 },
      { vol: 0.1, t: 50 },   // HUP 1
      { vol: 0.1, t: 200 },
      { vol: 0.5, t: 400 },
      { vol: 0.1, t: 450 },  // HUP 2 (400ms gap from first — > 150ms cooldown)
    ];
    expect(simulateHupDetector(frames)).toHaveLength(2);
  });
});
