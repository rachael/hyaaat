/**
 * Tests for targeting.js soft facing-direction algorithm.
 * Pure math — no DOM, no Three.js.
 */

import { describe, it, expect } from 'vitest';
import { scoreTarget, findTarget } from '../public/js/targeting.js';
import { COMBAT } from '../public/js/combat.js';

const AT_RANGE = COMBAT.ATTACK_RANGE;
const FALLBACK = COMBAT.NEARBY_FALLBACK_RANGE;

// Helpers
const pos = (x, z) => ({ x, z });
const facingNorth = pos(0, -1); // negative Z is "forward" in Three.js

describe('scoreTarget', () => {
  it('returns -1 when target is out of range', () => {
    const score = scoreTarget(pos(0, 0), facingNorth, pos(0, AT_RANGE + 1), AT_RANGE);
    expect(score).toBe(-1);
  });

  it('gives higher score to target directly in front vs same distance to side', () => {
    const local = pos(0, 0);
    const front = pos(0, -AT_RANGE * 0.8);    // in front
    const side  = pos(AT_RANGE * 0.8, 0);     // to the right, same distance

    const scoreFront = scoreTarget(local, facingNorth, front, AT_RANGE);
    const scoreSide  = scoreTarget(local, facingNorth, side, AT_RANGE);

    expect(scoreFront).toBeGreaterThan(scoreSide);
  });

  it('gives higher score to closer target when both in facing cone', () => {
    const local = pos(0, 0);
    const near = pos(0, -1);          // 1 unit in front
    const far  = pos(0, -AT_RANGE * 0.9);  // almost max range in front

    const scoreNear = scoreTarget(local, facingNorth, near, AT_RANGE);
    const scoreFar  = scoreTarget(local, facingNorth, far, AT_RANGE);

    expect(scoreNear).toBeGreaterThan(scoreFar);
  });

  it('returns positive score for target exactly at range', () => {
    const score = scoreTarget(pos(0, 0), facingNorth, pos(0, -AT_RANGE), AT_RANGE);
    expect(score).toBeGreaterThan(0);
  });

  it('returns positive score for target directly behind (facing bonus = 1.0)', () => {
    const score = scoreTarget(pos(0, 0), facingNorth, pos(0, 1), AT_RANGE);
    // Target is behind, within range
    expect(score).toBeGreaterThan(0);
  });
});

describe('findTarget', () => {
  it('returns null with no candidates', () => {
    expect(findTarget(pos(0, 0), facingNorth, [])).toBeNull();
  });

  it('targets the enemy directly in front', () => {
    const candidates = [
      { id: 'front', position: pos(0, -2) },
      { id: 'behind', position: pos(0, 2) },
    ];
    const target = findTarget(pos(0, 0), facingNorth, candidates);
    expect(target.id).toBe('front');
  });

  it('falls back to nearby enemy when nobody in attack range', () => {
    // Opponent is at FALLBACK range but outside ATTACK_RANGE
    const distBeyondAttack = AT_RANGE + 1;
    const candidates = [
      { id: 'nearby', position: pos(0, -distBeyondAttack) },
    ];
    const target = findTarget(pos(0, 0), facingNorth, candidates);
    expect(target.id).toBe('nearby');
  });

  it('returns null when enemy is beyond fallback range', () => {
    const candidates = [
      { id: 'far', position: pos(0, -(FALLBACK + 1)) },
    ];
    expect(findTarget(pos(0, 0), facingNorth, candidates)).toBeNull();
  });

  it('prefers facing bonus over proximity when both in attack range', () => {
    // Score formula: facingBonus / (dist² + ε)
    // For facing to beat proximity: 2.0/(d_front² + ε) > 1.0/(d_back² + ε)
    // → d_front < d_back × √2
    // Here: back=2.5, front=3.0 → 3.0 < 2.5×√2 ≈ 3.54 ✓
    const candidates = [
      { id: 'close-behind', position: pos(0, 2.5) },  // 2.5 units behind, no facing bonus
      { id: 'front-mid',    position: pos(0, -3.0) }, // 3.0 units in front, 2× facing bonus
    ];
    // score behind: 1.0 / (6.25 + ε) ≈ 0.160
    // score front:  2.0 / (9.00 + ε) ≈ 0.222  → front wins
    const target = findTarget(pos(0, 0), facingNorth, candidates);
    expect(target.id).toBe('front-mid');
  });

  it('returns the only valid candidate when there is one', () => {
    const candidates = [{ id: 'only', position: pos(1, -1) }];
    const target = findTarget(pos(0, 0), facingNorth, candidates);
    expect(target.id).toBe('only');
  });

  it('handles candidates at point-blank without crashing (epsilon guard)', () => {
    const candidates = [{ id: 'overlap', position: pos(0, 0) }];
    expect(() => findTarget(pos(0, 0), facingNorth, candidates)).not.toThrow();
  });
});
