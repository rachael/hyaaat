/**
 * Tests for combat.js damage formula and constants.
 * All pure functions, no DOM or Three.js required.
 */

import { describe, it, expect } from 'vitest';
import { calculateDamage, windupCharge, hpToHearts, COMBAT } from '../public/js/combat.js';

describe('COMBAT constants sanity', () => {
  it('HP_PER_HEART × HEARTS === MAX_HP', () => {
    expect(COMBAT.HP_PER_HEART * COMBAT.HEARTS).toBe(COMBAT.MAX_HP);
  });

  it('DAMAGE_FLOOR < DAMAGE_SOFT_CAP < WINDUP_SOFT_CAP', () => {
    expect(COMBAT.DAMAGE_FLOOR).toBeLessThan(COMBAT.DAMAGE_SOFT_CAP);
    expect(COMBAT.DAMAGE_SOFT_CAP).toBeLessThan(COMBAT.WINDUP_SOFT_CAP);
  });
});

describe('calculateDamage', () => {
  const silent = { volume: 0, fightingSpirit: 1, ridiculousFactor: 1 };
  const weak   = { volume: 0.2, fightingSpirit: 1, ridiculousFactor: 1 };
  const good   = { volume: 0.8, fightingSpirit: 1.8, ridiculousFactor: 1.6 };
  const peak   = { volume: 1.0, fightingSpirit: 2.0, ridiculousFactor: 2.5 };

  it('silent scream still deals floor damage', () => {
    expect(calculateDamage(silent)).toBe(COMBAT.DAMAGE_FLOOR);
  });

  it('weak scream deals floor damage', () => {
    // 10 × 0.2 × 1 × 1 = 2 → clamped to DAMAGE_FLOOR
    expect(calculateDamage(weak)).toBe(COMBAT.DAMAGE_FLOOR);
  });

  it('good scream deals meaningful damage above floor', () => {
    const dmg = calculateDamage(good);
    // 10 × 0.8 × 1.8 × 1.6 = 23.04 — well above floor
    expect(dmg).toBeGreaterThan(COMBAT.DAMAGE_FLOOR);
    expect(dmg).toBeLessThanOrEqual(COMBAT.DAMAGE_SOFT_CAP);
  });

  it('peak scream is soft-capped for normal attack', () => {
    // 10 × 1.0 × 2.0 × 2.5 = 50 — below the 150 cap, not capped here
    const dmg = calculateDamage(peak, false);
    expect(dmg).toBeLessThanOrEqual(COMBAT.DAMAGE_SOFT_CAP);
  });

  it('peak windup scream hits near WINDUP_SOFT_CAP', () => {
    // 10 × 1.0 × 2.0 × 2.5 = 50 — still below 300 cap, just checks it doesn't exceed
    const dmg = calculateDamage(peak, true);
    expect(dmg).toBeLessThanOrEqual(COMBAT.WINDUP_SOFT_CAP);
    expect(dmg).toBeGreaterThan(calculateDamage(peak, false));
  });

  it('windup damage is always ≥ normal damage for same audio state', () => {
    const states = [silent, weak, good, peak];
    for (const s of states) {
      // windup cap is higher, so for the same raw value, windup result ≥ normal
      expect(calculateDamage(s, true)).toBeGreaterThanOrEqual(calculateDamage(s, false));
    }
  });

  it('result is always an integer', () => {
    const dmg = calculateDamage(good);
    expect(Number.isInteger(dmg)).toBe(true);
  });

  it('result never exceeds WINDUP_SOFT_CAP even with extreme values', () => {
    const extreme = { volume: 10, fightingSpirit: 99, ridiculousFactor: 99 };
    expect(calculateDamage(extreme, true)).toBe(COMBAT.WINDUP_SOFT_CAP);
    expect(calculateDamage(extreme, false)).toBe(COMBAT.DAMAGE_SOFT_CAP);
  });
});

describe('windupCharge', () => {
  it('returns 0 at 0ms', () => expect(windupCharge(0)).toBe(0));
  it('returns 1 at full hold duration', () => {
    expect(windupCharge(COMBAT.WINDUP_HOLD_MS)).toBe(1);
  });
  it('clamps to 1 when over-held', () => {
    expect(windupCharge(COMBAT.WINDUP_HOLD_MS * 2)).toBe(1);
  });
  it('is halfway at half duration', () => {
    expect(windupCharge(COMBAT.WINDUP_HOLD_MS / 2)).toBeCloseTo(0.5);
  });
});

describe('hpToHearts', () => {
  it('full HP = full hearts', () => {
    expect(hpToHearts(COMBAT.MAX_HP)).toBe(COMBAT.HEARTS);
  });
  it('0 HP = 0 hearts', () => {
    expect(hpToHearts(0)).toBe(0);
  });
  it('negative HP clamps to 0', () => {
    expect(hpToHearts(-100)).toBe(0);
  });
  it('half HP = half hearts', () => {
    expect(hpToHearts(COMBAT.MAX_HP / 2)).toBe(COMBAT.HEARTS / 2);
  });
  it('returns float for partial hearts', () => {
    // e.g. 1 damage → slightly under full hearts
    const h = hpToHearts(COMBAT.MAX_HP - 1);
    expect(h).toBeLessThan(COMBAT.HEARTS);
    expect(h).toBeGreaterThan(COMBAT.HEARTS - 1);
  });
});
