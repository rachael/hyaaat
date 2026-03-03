/**
 * targeting.js — soft facing-direction target selection
 *
 * Pure functions. No DOM, no Three.js dependency (takes plain {x,z} objects).
 * See CLAUDE.md §Targeting for design rationale.
 *
 * Algorithm:
 *   score = facingBonus / (distance² + ε)
 *   facingBonus = 2.0 if target is within FACING_CONE_DEGREES of facing direction
 *               = 1.0 otherwise (falls back to nearest)
 *
 * Two range zones:
 *   ATTACK_RANGE         — committed hit zone, facing bonus applies
 *   NEARBY_FALLBACK_RANGE — if nobody in attack range, still target the closest
 *                           person nearby (no facing requirement in fallback)
 */

import { COMBAT } from './combat.js';

const FACING_CONE_RAD = (COMBAT.FACING_CONE_DEGREES * Math.PI) / 180;
const SCORE_EPSILON = 0.01; // prevent division by zero at point-blank

/**
 * Score a single candidate target.
 *
 * @param {{ x: number, z: number }} localPos
 * @param {{ x: number, z: number }} localFacing  unit vector in XZ plane
 * @param {{ x: number, z: number }} targetPos
 * @param {number} range  maximum distance to consider
 * @returns {number} score ≥ 0, or -1 if out of range
 */
export function scoreTarget(localPos, localFacing, targetPos, range) {
  const dx = targetPos.x - localPos.x;
  const dz = targetPos.z - localPos.z;
  const distance = Math.sqrt(dx * dx + dz * dz);

  if (distance > range) return -1;

  // dot product of facing vector and direction-to-target
  const len = distance + SCORE_EPSILON;
  const dot = (localFacing.x * dx + localFacing.z * dz) / len;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

  const facingBonus = angle < FACING_CONE_RAD ? 2.0 : 1.0;
  return facingBonus / (distance * distance + SCORE_EPSILON);
}

/**
 * Find the best target from a list of candidates.
 *
 * @param {{ x: number, z: number }} localPos
 * @param {{ x: number, z: number }} localFacing  unit vector in XZ plane
 * @param {Array<{ id: string, position: { x: number, z: number } }>} candidates
 * @returns {{ id: string, position: { x: number, z: number } } | null}
 */
export function findTarget(localPos, localFacing, candidates) {
  let bestScore = -1;
  let bestTarget = null;

  for (const candidate of candidates) {
    // Primary: score within attack range with facing bonus
    let score = scoreTarget(
      localPos,
      localFacing,
      candidate.position,
      COMBAT.ATTACK_RANGE,
    );

    // Fallback: if out of attack range but nearby, score without facing bonus
    if (score < 0) {
      const dx = candidate.position.x - localPos.x;
      const dz = candidate.position.z - localPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= COMBAT.NEARBY_FALLBACK_RANGE) {
        score = 1.0 / (dist * dist + SCORE_EPSILON);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestTarget = candidate;
    }
  }

  return bestTarget;
}
