/**
 * graphics/player-mesh.js — player visual factory
 *
 * SWAP THIS FILE to change player visuals. The rest of the game only calls
 * createPlayerMesh() and then moves/rotates the returned Object3D. No game
 * logic depends on the internals of the mesh.
 *
 * Returns a THREE.Group with:
 *   .setColor(hexColor)   — tint the mesh (called on spawn, not every frame)
 *   .setWindup(fraction)  — 0–1, charge aura intensity
 *   .setRolling(bool)     — toggle roll pose / stretch
 *
 * TODO: Replace placeholder capsule with a real character mesh. The group
 *   structure and named methods above must be preserved for main.js compatibility.
 */

import * as THREE from 'three';

const BODY_HEIGHT = 1.2;
const BODY_RADIUS = 0.35;
const HEAD_RADIUS = 0.28;

export function createPlayerMesh(options = {}) {
  const group = new THREE.Group();

  // ── Body (cylinder) ─────────────────────────────────────────────────────────
  const bodyGeo = new THREE.CylinderGeometry(
    BODY_RADIUS, BODY_RADIUS * 0.9, BODY_HEIGHT, 10,
  );
  const bodyMat = new THREE.MeshLambertMaterial({ color: options.color ?? 0x4488ff });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = BODY_HEIGHT / 2;
  body.castShadow = true;

  // ── Head (sphere) ──────────────────────────────────────────────────────────
  const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 12, 8);
  const headMat = new THREE.MeshLambertMaterial({ color: options.color ?? 0x4488ff });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = BODY_HEIGHT + HEAD_RADIUS * 0.8;
  head.castShadow = true;

  // ── Direction indicator (small forward-facing box) ─────────────────────────
  // Helps players see which way they're facing
  const noseGeo = new THREE.BoxGeometry(0.12, 0.12, 0.3);
  const noseMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.set(0, BODY_HEIGHT * 0.7, BODY_RADIUS + 0.1);

  // ── Windup aura (point light + emissive ring, hidden until windup) ─────────
  const auraGeo = new THREE.TorusGeometry(BODY_RADIUS * 1.4, 0.06, 8, 24);
  const auraMat = new THREE.MeshBasicMaterial({
    color: 0xffdd00,
    transparent: true,
    opacity: 0,
  });
  const aura = new THREE.Mesh(auraGeo, auraMat);
  aura.rotation.x = Math.PI / 2;
  aura.position.y = BODY_HEIGHT * 0.5;

  group.add(body, head, nose, aura);

  // Store refs for animation methods
  group.userData._body = body;
  group.userData._head = head;
  group.userData._bodyMat = bodyMat;
  group.userData._headMat = headMat;
  group.userData._auraMat = auraMat;
  group.userData._aura = aura;

  // ── API ─────────────────────────────────────────────────────────────────────

  group.setColor = (hex) => {
    bodyMat.color.setHex(hex);
    headMat.color.setHex(hex);
  };

  group.setWindup = (fraction) => {
    auraMat.opacity = fraction * 0.85;
    aura.scale.setScalar(1 + fraction * 0.3);
  };

  group.setRolling = (isRolling) => {
    // Lean the body forward during roll — simple tilt
    body.rotation.x = isRolling ? 0.5 : 0;
    head.position.y = isRolling
      ? BODY_HEIGHT + HEAD_RADIUS * 0.3
      : BODY_HEIGHT + HEAD_RADIUS * 0.8;
  };

  return group;
}
