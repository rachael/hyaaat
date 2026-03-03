/**
 * combat.js — damage formula and game balance constants
 *
 * Pure functions only. No DOM, no Three.js, no audio. Fully unit-testable.
 *
 * See CLAUDE.md §Damage formula for design rationale.
 */

export const COMBAT = Object.freeze({
  BASE_DAMAGE: 10,

  MAX_HP: 800,
  HEARTS: 10,
  HP_PER_HEART: 80, // MAX_HP / HEARTS

  DAMAGE_FLOOR: 8,        // minimum per hit — weak screams still register
  DAMAGE_SOFT_CAP: 150,   // maximum per normal hit
  WINDUP_SOFT_CAP: 300,   // maximum per windup release

  WINDUP_HOLD_MS: 2000,   // how long to hold for full windup
  WINDUP_COOLDOWN_MS: 6000,
  LIGHT_ATTACK_COOLDOWN_MS: 450,
  HEAVY_ATTACK_COOLDOWN_MS: 700,

  ATTACK_RANGE: 3.5,          // Three.js units — committed hit range
  NEARBY_FALLBACK_RANGE: 5.5, // targeting fallback range (no facing requirement)
  FACING_CONE_DEGREES: 70,    // half-angle of the soft facing cone
});

/**
 * Calculate damage for a single hit.
 *
 * @param {object} audioState
 * @param {number} audioState.volume        RMS volume, 0–1
 * @param {number} audioState.fightingSpirit  sustained volume EMA, 1–2
 * @param {number} audioState.ridiculousFactor  vowel run + battle cry bonus, 1–2.5
 * @param {boolean} isWindup  whether this is a windup release (2× cap)
 * @returns {number} integer damage value
 */
export function calculateDamage(audioState, isWindup = false) {
  const { volume, fightingSpirit, ridiculousFactor } = audioState;
  const raw = COMBAT.BASE_DAMAGE * volume * fightingSpirit * ridiculousFactor;
  // Windup doubles the effective damage before capping (see CLAUDE.md §Damage formula)
  const effective = isWindup ? raw * 2 : raw;
  const cap = isWindup ? COMBAT.WINDUP_SOFT_CAP : COMBAT.DAMAGE_SOFT_CAP;
  return Math.round(Math.max(COMBAT.DAMAGE_FLOOR, Math.min(effective, cap)));
}

/**
 * Returns the windup charge fraction (0–1) given how long the button has been held.
 */
export function windupCharge(heldMs) {
  return Math.min(heldMs / COMBAT.WINDUP_HOLD_MS, 1);
}

/**
 * How many hearts does this HP value correspond to (for display)?
 * Returns a float so the HUD can render a partial heart.
 */
export function hpToHearts(hp) {
  return Math.max(0, hp / COMBAT.HP_PER_HEART);
}
